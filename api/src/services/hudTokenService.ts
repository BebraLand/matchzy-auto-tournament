import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { db } from '../config/database';

const TOKEN_HASH_SETTING = 'jts_hud_token_hash';
const TOKEN_CREATED_SETTING = 'jts_hud_token_created_at';
const TOKEN_MODE_SETTING = 'jts_hud_token_mode';

export type HudTokenMode = 'manual' | 'automatic';

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

class HudTokenService {
  async createToken(
    mode: HudTokenMode = 'manual'
  ): Promise<{ token: string; createdAt: string; mode: HudTokenMode }> {
    const token = `mat_hud_${mode === 'automatic' ? 'auto_' : ''}${randomBytes(32).toString('base64url')}`;
    const createdAt = new Date().toISOString();
    await db.setAppSettingAsync(TOKEN_HASH_SETTING, hashToken(token).toString('hex'));
    await db.setAppSettingAsync(TOKEN_CREATED_SETTING, createdAt);
    await db.setAppSettingAsync(TOKEN_MODE_SETTING, mode);
    return { token, createdAt, mode };
  }

  async getStatus(): Promise<{
    configured: boolean;
    createdAt: string | null;
    mode: HudTokenMode;
  }> {
    const [hash, createdAt, mode] = await Promise.all([
      db.getAppSettingAsync(TOKEN_HASH_SETTING),
      db.getAppSettingAsync(TOKEN_CREATED_SETTING),
      db.getAppSettingAsync(TOKEN_MODE_SETTING),
    ]);
    return {
      configured: Boolean(hash),
      createdAt,
      mode: mode === 'automatic' ? 'automatic' : 'manual',
    };
  }

  async resolveToken(token: string | null | undefined): Promise<HudTokenMode | null> {
    if (!token) return null;
    const storedHash = await db.getAppSettingAsync(TOKEN_HASH_SETTING);
    if (!storedHash || !/^[a-f0-9]{64}$/i.test(storedHash)) return null;
    const candidate = hashToken(token);
    const expected = Buffer.from(storedHash, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null;
    return (await db.getAppSettingAsync(TOKEN_MODE_SETTING)) === 'automatic'
      ? 'automatic'
      : 'manual';
  }

  async verifyToken(token: string | null | undefined): Promise<boolean> {
    return (await this.resolveToken(token)) !== null;
  }
}

export const hudTokenService = new HudTokenService();
