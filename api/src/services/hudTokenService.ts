import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { db } from '../config/database';

const TOKEN_HASH_SETTING = 'jts_hud_token_hash';
const TOKEN_CREATED_SETTING = 'jts_hud_token_created_at';

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

class HudTokenService {
  async createToken(): Promise<{ token: string; createdAt: string }> {
    const token = `mat_hud_${randomBytes(32).toString('base64url')}`;
    const createdAt = new Date().toISOString();
    await db.setAppSettingAsync(TOKEN_HASH_SETTING, hashToken(token).toString('hex'));
    await db.setAppSettingAsync(TOKEN_CREATED_SETTING, createdAt);
    return { token, createdAt };
  }

  async getStatus(): Promise<{ configured: boolean; createdAt: string | null }> {
    const [hash, createdAt] = await Promise.all([
      db.getAppSettingAsync(TOKEN_HASH_SETTING),
      db.getAppSettingAsync(TOKEN_CREATED_SETTING),
    ]);
    return { configured: Boolean(hash), createdAt };
  }

  async verifyToken(token: string | null | undefined): Promise<boolean> {
    if (!token) return false;
    const storedHash = await db.getAppSettingAsync(TOKEN_HASH_SETTING);
    if (!storedHash || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
    const candidate = hashToken(token);
    const expected = Buffer.from(storedHash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
}

export const hudTokenService = new HudTokenService();
