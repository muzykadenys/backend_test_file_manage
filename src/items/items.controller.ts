import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isPublicSelfOrAncestor } from '../lib/itemPublicAccess';
import { getSupabase } from '../lib/supabase';
import { extensionForUploadedFile, normalizeUploadedFileMime } from '../lib/mime';
import {
  decodeMulterUtf8Filename,
  normalizeFolderName,
  normalizeItemName,
  normalizeUploadedFileDisplayName,
} from '../lib/transliterate';
import { getSignedUrlExpiresSeconds } from '../lib/signedUrl';
import { getMaxUploadBytes, getMaxUploadMbLabel } from '../lib/upload';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { CreateFolderDto, ReorderDto, ShareCreateDto, UpdateItemDto } from './dto';
import { randomUUID } from 'crypto';

const BUCKET = 'files';

@ApiTags('items')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('items')
export class ItemsController {
  @Get()
  @ApiOperation({
    summary: 'List items in a folder (root if parentId omitted)',
    description:
      'Root lists only your own items. With parentId, lists children if you own the folder, it is public, or you have share access (same rules as deep links).',
  })
  async list(@Req() req: AuthedRequest, @Query('parentId') parentId?: string) {
    const supabase = getSupabase();
    const uid = req.userId;
    if (!parentId) {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('owner_id', uid)
        .is('parent_id', null)
        .order('sort_order', { ascending: true });
      if (error) throw new InternalServerErrorException(error.message);
      const ownerEmail = req.userEmail?.trim() ?? null;
      return {
        items: (data ?? []).map((row) => ({
          ...row,
          owner_email: ownerEmail,
          my_role: 'owner',
          can_manage: true,
        })),
      };
    }
    const { data: parent, error: pe } = await supabase.from('items').select('*').eq('id', parentId).single();
    if (pe || !parent) throw new NotFoundException();
    const isOwner = parent.owner_id === uid;
    if (isOwner) {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('owner_id', uid)
        .eq('parent_id', parentId)
        .order('sort_order', { ascending: true });
      if (error) throw new InternalServerErrorException(error.message);
      const ownerEmail = req.userEmail?.trim() ?? null;
      return {
        items: (data ?? []).map((row) => ({
          ...row,
          owner_email: ownerEmail,
          my_role: 'owner',
          can_manage: true,
        })),
      };
    }
    const canReadParent = await this.canReadItem(supabase, req, parent as Record<string, unknown>);
    if (!canReadParent) throw new NotFoundException();
    const { data: rawChildren, error } = await supabase
      .from('items')
      .select('*')
      .eq('parent_id', parentId)
      .eq('owner_id', parent.owner_id as string)
      .order('sort_order', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    const readable: Record<string, unknown>[] = [];
    for (const row of rawChildren ?? []) {
      if (await this.canReadItem(supabase, req, row as Record<string, unknown>)) readable.push(row as Record<string, unknown>);
    }
    const withEmails = await this.attachOwnerEmailsFromAuth(supabase, readable);
    const em = req.userEmail?.trim();
    if (em) {
      const items = await this.enrichSharedItemRoles(supabase, ItemsController.normalizeEmail(em), withEmails);
      return { items };
    }
    return {
      items: withEmails.map((row) => ({
        ...row,
        my_role: 'read',
        can_manage: false,
      })),
    };
  }

  @Get('shared-with-me')
  @ApiOperation({ summary: 'List items shared with the current user (by email)' })
  async listSharedWithMe(@Req() req: AuthedRequest, @Query('parentId') parentId?: string) {
    const email = req.userEmail?.trim();
    if (!email) {
      throw new BadRequestException(
        'User email is required for shared items (JWT session or X-User-Email with demo token)',
      );
    }
    const supabase = getSupabase();
    const normalized = ItemsController.normalizeEmail(email);
    if (parentId) {
      return this.listSharedChildren(supabase, normalized, parentId);
    }
    return this.listSharedRoots(supabase, normalized);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search by name (ilike)' })
  async search(@Req() req: AuthedRequest, @Query('q') term: string) {
    if (!term?.trim()) return { items: [] };
    const supabase = getSupabase();
    const uid = req.userId;
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('owner_id', uid)
      .ilike('name', `%${term.trim()}%`)
      .order('sort_order', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    const ownerEmail = req.userEmail?.trim() ?? null;
    return {
      items: (data ?? []).map((row) => ({
        ...row,
        owner_email: ownerEmail,
        my_role: 'owner',
        can_manage: true,
      })),
    };
  }

  @Get(':id/context')
  @ApiOperation({ summary: 'Item metadata and folder path from root (for deep links)' })
  async getItemContext(@Req() req: AuthedRequest, @Param('id') id: string) {
    const supabase = getSupabase();
    const uid = req.userId;
    const { data: item, error } = await supabase.from('items').select('*').eq('id', id).single();
    if (error || !item) throw new NotFoundException();
    const isOwner = item.owner_id === uid;
    const canRead = await this.canReadItem(supabase, req, item as Record<string, unknown>);
    if (!canRead) throw new NotFoundException();
    const pathFromRoot = await this.folderPathChainFromItem(supabase, item as Record<string, unknown>);
    let enriched: Record<string, unknown>;
    if (isOwner) {
      const ownerEmail = req.userEmail?.trim() ?? null;
      enriched = {
        ...item,
        owner_email: ownerEmail,
        my_role: 'owner',
        can_manage: true,
      };
    } else if (await isPublicSelfOrAncestor(supabase, item as Record<string, unknown>)) {
      const withEmails = await this.attachOwnerEmailsFromAuth(supabase, [item as Record<string, unknown>]);
      enriched = {
        ...(withEmails[0] ?? item),
        my_role: 'read',
        can_manage: false,
      };
    } else {
      const em = req.userEmail?.trim();
      if (!em) throw new UnauthorizedException('Email required to open a shared item');
      const withEmails = await this.attachOwnerEmailsFromAuth(supabase, [item as Record<string, unknown>]);
      const rows = await this.enrichSharedItemRoles(supabase, ItemsController.normalizeEmail(em), withEmails);
      enriched = rows[0] ?? { ...item };
    }
    return { item: enriched, pathFromRoot };
  }

  @Get(':id/file-url')
  @ApiOperation({ summary: 'Signed URL to view or download a file' })
  async fileUrl(@Req() req: AuthedRequest, @Param('id') id: string) {
    const supabase = getSupabase();
    const { data: item, error } = await supabase.from('items').select('*').eq('id', id).single();
    if (error || !item) throw new NotFoundException();
    if (item.item_type !== 'file' || !item.storage_path) throw new BadRequestException('Not a file');
    const canRead = await this.canReadItem(supabase, req, item as Record<string, unknown>);
    if (!canRead) throw new NotFoundException();
    const { data: signed, error: su } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(item.storage_path as string, getSignedUrlExpiresSeconds());
    if (su || !signed) throw new BadRequestException(su?.message ?? 'Could not sign URL');
    return { url: signed.signedUrl };
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Stream file bytes (same access as file-url)',
    description:
      'Returns the file through the API so the browser never sees a Supabase signed URL. Prefer this for previews and downloads.',
  })
  @Header('Cache-Control', 'private, no-store')
  async fileStream(@Req() req: AuthedRequest, @Param('id') id: string): Promise<StreamableFile> {
    const supabase = getSupabase();
    const { data: item, error } = await supabase.from('items').select('*').eq('id', id).single();
    if (error || !item) throw new NotFoundException();
    if (item.item_type !== 'file' || !item.storage_path) throw new BadRequestException('Not a file');
    const canRead = await this.canReadItem(supabase, req, item as Record<string, unknown>);
    if (!canRead) throw new NotFoundException();
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(item.storage_path as string);
    if (dlErr || !fileBlob) throw new BadRequestException(dlErr?.message ?? 'Could not read file');
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const mime = typeof item.mime_type === 'string' && item.mime_type.trim() ? item.mime_type : 'application/octet-stream';
    return new StreamableFile(buffer, { type: mime });
  }

  @Post('folder')
  @ApiOperation({ summary: 'Create folder' })
  async createFolder(@Req() req: AuthedRequest, @Body() body: CreateFolderDto) {
    const supabase = getSupabase();
    const uid = req.userId;
    const sortOrder = await this.nextSortOrder(supabase, uid, body.parentId ?? null);
    const { data, error } = await supabase
      .from('items')
      .insert({
        parent_id: body.parentId ?? null,
        name: normalizeFolderName(body.name),
        item_type: 'folder',
        sort_order: sortOrder,
        is_public: body.isPublic ?? false,
        owner_id: uid,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return { item: data };
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        parentId: { type: 'string', nullable: true },
        name: { type: 'string' },
        isPublic: { type: 'boolean' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: getMaxUploadBytes() },
    }),
  )
  @ApiOperation({ summary: 'Upload any file (max size from MAX_UPLOAD_FILE_SIZE_MB, default 10)' })
  async upload(@Req() req: AuthedRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('file is required');
    const maxBytes = getMaxUploadBytes();
    if (file.size > maxBytes) {
      throw new BadRequestException(`File is too large. Maximum size is ${getMaxUploadMbLabel()} MB.`);
    }
    const body = req.body as { parentId?: string; name?: string; isPublic?: string };
    const parentId = typeof body.parentId === 'string' ? body.parentId : undefined;
    const name = typeof body.name === 'string' ? body.name : undefined;
    const isPublic = body.isPublic;
    const normalizedMime = normalizeUploadedFileMime(file.mimetype);
    const origDecoded = decodeMulterUtf8Filename(file.originalname);
    const ext = extensionForUploadedFile(origDecoded, normalizedMime);
    const supabase = getSupabase();
    const uid = req.userId;
    if (parentId) {
      const { data: parent, error: parentErr } = await supabase
        .from('items')
        .select('id, owner_id, item_type')
        .eq('id', parentId)
        .maybeSingle();
      if (parentErr || !parent) throw new BadRequestException('Parent folder not found');
      if (parent.owner_id !== uid) throw new BadRequestException('Parent folder not found');
      if (parent.item_type !== 'folder') throw new BadRequestException('Parent must be a folder');
    }
    const id = randomUUID();
    const storagePath = `${uid}/${id}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file.buffer, {
      contentType: normalizedMime,
      upsert: false,
    });
    if (upErr) throw new BadRequestException(upErr.message);
    const sortOrder = await this.nextSortOrder(supabase, uid, parentId || null);
    const rawDisplay = (name?.trim() || origDecoded || `file.${ext}`).trim();
    const displayName = normalizeUploadedFileDisplayName(rawDisplay);
    const { data, error } = await supabase
      .from('items')
      .insert({
        id,
        parent_id: parentId || null,
        name: displayName,
        item_type: 'file',
        sort_order: sortOrder,
        is_public: isPublic === 'true' || isPublic === '1' || isPublic === 'on',
        owner_id: uid,
        storage_path: storagePath,
        mime_type: normalizedMime,
      })
      .select()
      .single();
    if (error) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      throw new BadRequestException(error.message);
    }
    return { item: data };
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Update sort order for multiple items' })
  async reorder(@Req() req: AuthedRequest, @Body() body: ReorderDto) {
    const supabase = getSupabase();
    const uid = req.userId;
    for (const row of body.items) {
      const { error } = await supabase
        .from('items')
        .update({ sort_order: row.sortOrder, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('owner_id', uid);
      if (error) throw new BadRequestException(error.message);
    }
    return { ok: true };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename or toggle visibility (visibility: owner or share admin only)' })
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: UpdateItemDto) {
    const supabase = getSupabase();
    const wantsName = body.name !== undefined;
    const wantsPublic = body.isPublic !== undefined;
    if (!wantsName && !wantsPublic) throw new BadRequestException('No fields to update');
    await this.assertCanPatchItem(supabase, req, id, wantsName, wantsPublic);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = normalizeItemName(body.name);
    if (body.isPublic !== undefined) patch.is_public = body.isPublic;
    const { data, error } = await supabase.from('items').update(patch).eq('id', id).select().single();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException();
    if (body.isPublic === true && data.item_type === 'folder') {
      await this.propagatePublicToDescendants(supabase, req.userId, id);
    }
    return { item: data };
  }

  /** When a folder is set public, mark every nested file/folder (same owner) as public in DB. */
  private async propagatePublicToDescendants(
    supabase: ReturnType<typeof getSupabase>,
    ownerId: string,
    folderId: string,
  ): Promise<void> {
    const { data: all } = await supabase.from('items').select('id, parent_id').eq('owner_id', ownerId);
    const byParent = new Map<string | null, string[]>();
    for (const r of all ?? []) {
      const pid = r.parent_id as string | null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(r.id as string);
    }
    const stack = [...(byParent.get(folderId) ?? [])];
    const descendantIds: string[] = [];
    while (stack.length) {
      const nid = stack.pop()!;
      descendantIds.push(nid);
      for (const c of byParent.get(nid) ?? []) stack.push(c);
    }
    if (descendantIds.length === 0) return;
    const now = new Date().toISOString();
    const chunkSize = 100;
    for (let i = 0; i < descendantIds.length; i += chunkSize) {
      const chunk = descendantIds.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('items')
        .update({ is_public: true, updated_at: now })
        .in('id', chunk)
        .eq('owner_id', ownerId);
      if (error) throw new BadRequestException(error.message);
    }
  }

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone file or folder (recursive for folders)' })
  async clone(@Req() req: AuthedRequest, @Param('id') id: string) {
    const supabase = getSupabase();
    const uid = req.userId;
    const { data: root, error: e1 } = await supabase
      .from('items')
      .select('*')
      .eq('id', id)
      .eq('owner_id', uid)
      .single();
    if (e1 || !root) throw new NotFoundException();
    const newRootId = await this.cloneSubtree(supabase, uid, root as Record<string, unknown>, root.parent_id as string | null);
    const { data: created } = await supabase.from('items').select('*').eq('id', newRootId).single();
    return { item: created };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove item (cascade children)' })
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    const supabase = getSupabase();
    const uid = req.userId;
    const { data: row, error: e1 } = await supabase
      .from('items')
      .select('*')
      .eq('id', id)
      .eq('owner_id', uid)
      .single();
    if (e1 || !row) throw new NotFoundException();
    const paths = await this.collectFilePathsUnder(supabase, uid, id);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from('items').delete().eq('id', id).eq('owner_id', uid);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  @Post(':id/share')
  @ApiOperation({ summary: 'Share by email (owner or share admin). Public link option disabled in UI.' })
  async share(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: ShareCreateDto) {
    const supabase = getSupabase();
    const { data: item, error: e1 } = await supabase.from('items').select('id').eq('id', id).single();
    if (e1 || !item) throw new NotFoundException();
    if (!(await this.canManageItem(supabase, req, id))) {
      throw new ForbiddenException('Only the owner or a collaborator with admin can share');
    }
    const { data, error } = await supabase
      .from('item_shares')
      .insert({
        item_id: id,
        email: ItemsController.normalizeEmail(body.email),
        permission: body.permission,
        share_token: null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return { share: data, publicPath: null };
  }

  @Get(':id/shares')
  @ApiOperation({ summary: 'List email-based shares for this item (owner or admin only)' })
  async listShares(@Req() req: AuthedRequest, @Param('id') id: string) {
    const supabase = getSupabase();
    const { data: item, error: e1 } = await supabase.from('items').select('id').eq('id', id).single();
    if (e1 || !item) throw new NotFoundException();
    if (!(await this.canManageItem(supabase, req, id))) {
      throw new ForbiddenException('Only the owner or a collaborator with admin can view shares');
    }
    const { data, error } = await supabase
      .from('item_shares')
      .select('id, email, permission, created_at')
      .eq('item_id', id)
      .is('share_token', null)
      .order('created_at', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    return { shares: data ?? [] };
  }

  @Delete(':id/shares/:shareId')
  @ApiOperation({ summary: 'Revoke a share by row id (owner or admin only)' })
  async revokeShare(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('shareId') shareId: string,
  ) {
    const supabase = getSupabase();
    const { data: item, error: e1 } = await supabase.from('items').select('id').eq('id', id).single();
    if (e1 || !item) throw new NotFoundException();
    if (!(await this.canManageItem(supabase, req, id))) {
      throw new ForbiddenException('Only the owner or a collaborator with admin can revoke shares');
    }
    const { error: dErr } = await supabase.from('item_shares').delete().eq('id', shareId).eq('item_id', id);
    if (dErr) throw new BadRequestException(dErr.message);
    return { ok: true };
  }

  private async nextSortOrder(
    supabase: ReturnType<typeof getSupabase>,
    ownerId: string,
    parentId: string | null,
  ): Promise<number> {
    let qb = supabase.from('items').select('sort_order').eq('owner_id', ownerId);
    if (parentId) qb = qb.eq('parent_id', parentId);
    else qb = qb.is('parent_id', null);
    const { data } = await qb.order('sort_order', { ascending: false }).limit(1);
    const max = data?.[0]?.sort_order;
    return typeof max === 'number' ? max + 1 : 0;
  }

  private async cloneSubtree(
    supabase: ReturnType<typeof getSupabase>,
    ownerId: string,
    node: Record<string, unknown>,
    newParentId: string | null,
  ): Promise<string> {
    const newId = randomUUID();
    const sortOrder = await this.nextSortOrder(supabase, ownerId, newParentId);
    if (node.item_type === 'file' && node.storage_path && typeof node.storage_path === 'string') {
      const oldPath = node.storage_path as string;
      const parts = oldPath.split('.');
      const ext = parts.length > 1 ? parts[parts.length - 1] : 'bin';
      const newPath = `${ownerId}/${newId}.${ext}`;
      const { error: copyErr } = await supabase.storage.from(BUCKET).copy(oldPath, newPath);
      if (copyErr) {
        const { data: blob, error: dl } = await supabase.storage.from(BUCKET).download(oldPath);
        if (dl || !blob) throw new BadRequestException(copyErr.message);
        const buf = Buffer.from(await blob.arrayBuffer());
        const { error: up } = await supabase.storage.from(BUCKET).upload(newPath, buf, {
          contentType: (node.mime_type as string) || 'application/octet-stream',
        });
        if (up) throw new BadRequestException(up.message);
      }
      const { error } = await supabase.from('items').insert({
        id: newId,
        parent_id: newParentId,
        name: `${String(node.name)} (copy)`,
        item_type: 'file',
        sort_order: sortOrder,
        is_public: node.is_public ?? false,
        owner_id: ownerId,
        storage_path: newPath,
        mime_type: node.mime_type,
      });
      if (error) throw new BadRequestException(error.message);
      return newId;
    }
    const { error: insErr } = await supabase.from('items').insert({
      id: newId,
      parent_id: newParentId,
      name: `${String(node.name)} (copy)`,
      item_type: 'folder',
      sort_order: sortOrder,
      is_public: node.is_public ?? false,
      owner_id: ownerId,
    });
    if (insErr) throw new BadRequestException(insErr.message);
    const { data: children } = await supabase
      .from('items')
      .select('*')
      .eq('parent_id', node.id)
      .eq('owner_id', ownerId);
    for (const ch of children ?? []) {
      await this.cloneSubtree(supabase, ownerId, ch as Record<string, unknown>, newId);
    }
    return newId;
  }

  private async collectFilePathsUnder(
    supabase: ReturnType<typeof getSupabase>,
    ownerId: string,
    rootId: string,
  ): Promise<string[]> {
    const { data: all } = await supabase
      .from('items')
      .select('id, parent_id, item_type, storage_path')
      .eq('owner_id', ownerId);
    const children = new Map<string | null, string[]>();
    for (const r of all ?? []) {
      const pid = r.parent_id as string | null;
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid)!.push(r.id as string);
    }
    const paths: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      const row = (all ?? []).find((x) => x.id === id);
      if (row?.item_type === 'file' && row.storage_path) paths.push(row.storage_path as string);
      for (const c of children.get(id) ?? []) stack.push(c);
    }
    return paths;
  }

  /** Folder chain from root to the containing folder (for a file) or through the folder itself (for a folder). */
  private async folderPathChainFromItem(
    supabase: ReturnType<typeof getSupabase>,
    item: Record<string, unknown>,
  ): Promise<{ id: string; name: string }[]> {
    const itemType = item.item_type as string;
    let cur: string | null =
      itemType === 'file' ? (item.parent_id as string | null) : (item.id as string);
    const chain: { id: string; name: string }[] = [];
    while (cur) {
      const { data: row, error } = await supabase
        .from('items')
        .select('id, name, parent_id')
        .eq('id', cur)
        .single();
      if (error || !row) break;
      chain.push({ id: row.id as string, name: row.name as string });
      cur = row.parent_id as string | null;
    }
    return chain.reverse();
  }

  private static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Owner, public (self or under a public folder), or email-based share on this item or an ancestor. */
  private async canReadItem(
    supabase: ReturnType<typeof getSupabase>,
    req: AuthedRequest,
    item: Record<string, unknown>,
  ): Promise<boolean> {
    const uid = req.userId;
    if (item.owner_id === uid) return true;
    if (await isPublicSelfOrAncestor(supabase, item)) return true;
    const em = req.userEmail?.trim();
    if (!em) return false;
    return this.hasSharedAccess(supabase, ItemsController.normalizeEmail(em), item.id as string);
  }

  /** True if `normalizedEmail` has a share row on this exact item (email compared case-insensitively). */
  private async emailHasShareOnItem(
    supabase: ReturnType<typeof getSupabase>,
    normalizedEmail: string,
    itemId: string,
  ): Promise<boolean> {
    const { data, error } = await supabase.from('item_shares').select('id, email').eq('item_id', itemId);
    if (error || !data?.length) return false;
    return data.some((row) => ItemsController.normalizeEmail(String(row.email)) === normalizedEmail);
  }

  /**
   * Share on this item or any ancestor. A row on a folder grants access to that folder’s entire subtree
   * (listing children, opening files, context/deep links) for that email.
   */
  private async hasSharedAccess(
    supabase: ReturnType<typeof getSupabase>,
    normalizedEmail: string,
    itemId: string,
  ): Promise<boolean> {
    let cur: string | null = itemId;
    while (cur) {
      if (await this.emailHasShareOnItem(supabase, normalizedEmail, cur)) return true;
      const res = await supabase.from('items').select('parent_id').eq('id', cur).single();
      const pid = res.data?.parent_id as string | null | undefined;
      cur = pid ?? null;
    }
    return false;
  }

  private async listSharedRoots(
    supabase: ReturnType<typeof getSupabase>,
    normalizedEmail: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    const { data: shareRows, error: e1 } = await supabase.from('item_shares').select('item_id, email');
    if (e1) throw new InternalServerErrorException(e1.message);
    const sharedItemIds = new Set(
      (shareRows ?? [])
        .filter((r) => ItemsController.normalizeEmail(String(r.email)) === normalizedEmail)
        .map((r) => r.item_id as string),
    );
    if (sharedItemIds.size === 0) return { items: [] };
    const { data: candidates, error: e2 } = await supabase
      .from('items')
      .select('*')
      .in('id', [...sharedItemIds])
      .order('sort_order', { ascending: true });
    if (e2) throw new InternalServerErrorException(e2.message);
    const rows = (candidates ?? []).filter((it) => {
      const pid = it.parent_id as string | null;
      if (!pid) return true;
      return !sharedItemIds.has(pid);
    });
    const withEmails = await this.attachOwnerEmailsFromAuth(supabase, rows);
    const items = await this.enrichSharedItemRoles(supabase, normalizedEmail, withEmails);
    return { items };
  }

  /** Lists direct children of `parentId` if the user has share access on this folder or any ancestor (folder share = subtree). */
  private async listSharedChildren(
    supabase: ReturnType<typeof getSupabase>,
    normalizedEmail: string,
    parentId: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    const { data: parent, error: pe } = await supabase.from('items').select('*').eq('id', parentId).single();
    if (pe || !parent) throw new NotFoundException();
    const ok = await this.hasSharedAccess(supabase, normalizedEmail, parentId);
    if (!ok) throw new NotFoundException();
    const { data: children, error } = await supabase
      .from('items')
      .select('*')
      .eq('parent_id', parentId)
      .eq('owner_id', parent.owner_id as string)
      .order('sort_order', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    const withEmails = await this.attachOwnerEmailsFromAuth(supabase, children ?? []);
    const items = await this.enrichSharedItemRoles(supabase, normalizedEmail, withEmails);
    return { items };
  }

  private async attachOwnerEmailsFromAuth(
    supabase: ReturnType<typeof getSupabase>,
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    if (!rows.length) return [];
    const ownerIds = [...new Set(rows.map((r) => r.owner_id as string))];
    const emailById = new Map<string, string>();
    await Promise.all(
      ownerIds.map(async (oid) => {
        const { data, error } = await supabase.auth.admin.getUserById(oid);
        if (!error && data?.user?.email) emailById.set(oid, data.user.email);
      }),
    );
    return rows.map((row) => ({
      ...row,
      owner_email: emailById.get(row.owner_id as string) ?? null,
    }));
  }

  /** Strongest share permission along the path from item to root (for this email). */
  private async effectiveSharePermission(
    supabase: ReturnType<typeof getSupabase>,
    normalizedEmail: string,
    itemId: string,
  ): Promise<'read' | 'write' | 'admin' | null> {
    const rank: Record<string, number> = { read: 1, write: 2, admin: 3 };
    let best: 'read' | 'write' | 'admin' | null = null;
    let cur: string | null = itemId;
    while (cur) {
      const { data: rows } = await supabase.from('item_shares').select('permission, email').eq('item_id', cur);
      for (const r of rows ?? []) {
        if (ItemsController.normalizeEmail(String((r as { email: string }).email)) !== normalizedEmail) continue;
        const raw = String((r as { permission: string }).permission).toLowerCase();
        if (raw !== 'read' && raw !== 'write' && raw !== 'admin') continue;
        if (!best || rank[raw] > rank[best]) best = raw as 'read' | 'write' | 'admin';
      }
      const res = await supabase.from('items').select('parent_id').eq('id', cur).single();
      const pid = res.data?.parent_id as string | null | undefined;
      cur = pid ?? null;
    }
    return best;
  }

  private async canManageItem(
    supabase: ReturnType<typeof getSupabase>,
    req: AuthedRequest,
    itemId: string,
  ): Promise<boolean> {
    const { data: item } = await supabase.from('items').select('owner_id').eq('id', itemId).single();
    if (!item) return false;
    if (item.owner_id === req.userId) return true;
    const em = req.userEmail?.trim();
    if (!em) return false;
    const perm = await this.effectiveSharePermission(supabase, ItemsController.normalizeEmail(em), itemId);
    return perm === 'admin';
  }

  private async assertCanPatchItem(
    supabase: ReturnType<typeof getSupabase>,
    req: AuthedRequest,
    itemId: string,
    wantsName: boolean,
    wantsPublic: boolean,
  ): Promise<void> {
    const { data: item } = await supabase.from('items').select('owner_id').eq('id', itemId).single();
    if (!item) throw new NotFoundException();
    if (item.owner_id === req.userId) return;
    const em = req.userEmail?.trim();
    if (!em) throw new ForbiddenException('Email required for this action');
    const perm = await this.effectiveSharePermission(supabase, ItemsController.normalizeEmail(em), itemId);
    if (!perm) throw new ForbiddenException();
    if (wantsPublic && perm !== 'admin') {
      throw new ForbiddenException('Only admins can change public/private visibility');
    }
    if (wantsName && perm === 'read') {
      throw new ForbiddenException('Insufficient permission to rename');
    }
  }

  private async enrichSharedItemRoles(
    supabase: ReturnType<typeof getSupabase>,
    normalizedEmail: string,
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const row of rows) {
      const id = row.id as string;
      const perm = await this.effectiveSharePermission(supabase, normalizedEmail, id);
      const can_manage = perm === 'admin';
      out.push({ ...row, my_role: perm, can_manage });
    }
    return out;
  }
}
