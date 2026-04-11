import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { isPublicForAnonymousAccess } from '../lib/itemPublicAccess';
import { getSupabase } from '../lib/supabase';

const BUCKET = 'files';

/** Same chain as ItemsController.folderPathChainFromItem — call only after isPublicForAnonymousAccess passes. */
async function folderPathChainFromItem(
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

@ApiTags('public')
@Controller('public')
export class PublicController {
  @Get('items/:id/context')
  @ApiOperation({ summary: 'Item metadata + folder path for anonymous users (public items only)' })
  async publicItemContext(@Param('id') id: string) {
    const supabase = getSupabase();
    const { data: item, error } = await supabase.from('items').select('*').eq('id', id).single();
    if (error || !item) throw new NotFoundException();
    if (!isPublicForAnonymousAccess(item as Record<string, unknown>)) {
      throw new NotFoundException();
    }
    const pathFromRoot = await folderPathChainFromItem(supabase, item as Record<string, unknown>);
    const row = item as Record<string, unknown>;
    const enriched = {
      ...row,
      my_role: 'read',
      can_manage: false,
    };
    return { item: enriched, pathFromRoot };
  }

  @Get('items/:id/children')
  @ApiOperation({ summary: 'List direct children of a public folder (anonymous)' })
  async publicItemChildren(@Param('id') id: string) {
    const supabase = getSupabase();
    const { data: parent, error: pe } = await supabase.from('items').select('*').eq('id', id).single();
    if (pe || !parent) throw new NotFoundException();
    if ((parent as { item_type: string }).item_type !== 'folder') throw new NotFoundException();
    if (!isPublicForAnonymousAccess(parent as Record<string, unknown>)) {
      throw new NotFoundException();
    }
    const ownerId = (parent as { owner_id: string }).owner_id;
    const { data: rawChildren, error } = await supabase
      .from('items')
      .select('*')
      .eq('parent_id', id)
      .eq('owner_id', ownerId)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const items: Record<string, unknown>[] = [];
    for (const row of rawChildren ?? []) {
      if (isPublicForAnonymousAccess(row as Record<string, unknown>)) {
        items.push({
          ...row,
          my_role: 'read',
          can_manage: false,
        });
      }
    }
    return { items };
  }

  @Get('items/:id/file')
  @ApiOperation({ summary: 'Stream public file bytes (no auth)' })
  @Header('Cache-Control', 'private, no-store')
  async publicItemFile(@Param('id') id: string): Promise<StreamableFile> {
    const supabase = getSupabase();
    const { data: item, error } = await supabase.from('items').select('*').eq('id', id).single();
    if (error || !item) throw new NotFoundException();
    if (!isPublicForAnonymousAccess(item as Record<string, unknown>)) {
      throw new NotFoundException();
    }
    if (item.item_type !== 'file' || !item.storage_path) throw new NotFoundException();
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(item.storage_path as string);
    if (dlErr || !fileBlob) throw new BadRequestException(dlErr?.message ?? 'Could not read file');
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const mime =
      typeof item.mime_type === 'string' && item.mime_type.trim() ? item.mime_type : 'application/octet-stream';
    return new StreamableFile(buffer, { type: mime });
  }

  @Get('share/:token/file')
  @ApiOperation({ summary: 'Stream file bytes for a public share link (no Supabase signed URL)' })
  @Header('Cache-Control', 'private, no-store')
  async shareFile(@Param('token') token: string): Promise<StreamableFile> {
    const supabase = getSupabase();
    const { data: row, error } = await supabase
      .from('item_shares')
      .select('*, items(*)')
      .eq('share_token', token)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!row) throw new NotFoundException();
    const item = (row as { items: Record<string, unknown> }).items;
    if (!item) throw new NotFoundException();
    if (item.item_type !== 'file' || !item.storage_path) throw new NotFoundException();
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(item.storage_path as string);
    if (dlErr || !fileBlob) throw new BadRequestException(dlErr?.message ?? 'Could not read file');
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const mime =
      typeof item.mime_type === 'string' && item.mime_type.trim() ? item.mime_type : 'application/octet-stream';
    return new StreamableFile(buffer, { type: mime });
  }

  @Get('share/:token')
  @ApiOperation({ summary: 'View shared item metadata via public link token (read)' })
  async share(@Param('token') token: string) {
    const supabase = getSupabase();
    const { data: row, error } = await supabase
      .from('item_shares')
      .select('*, items(*)')
      .eq('share_token', token)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!row) throw new NotFoundException();
    const item = (row as { items: Record<string, unknown> }).items;
    if (!item) throw new NotFoundException();
    return {
      permission: (row as { permission: string }).permission,
      item: {
        id: item.id,
        name: item.name,
        item_type: item.item_type,
        is_public: item.is_public,
        mime_type: item.mime_type ?? null,
      },
    };
  }
}
