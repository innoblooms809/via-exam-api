import bcrypt from 'bcryptjs';
import config from '../config/config';

// Passwords are hashed (one-way) with bcrypt, never encrypted: nobody, not even the server, can
// read them back. Columns the app must read back are encrypted by utils/dataProtection.ts.
//
// Cost factor of new hashes: 10 by default (OWASP's minimum for bcrypt), BCRYPT_ROUNDS to change it
// (ENC_SECRET_KEY, its old name, still works). Each step doubles the work, and bcryptjs runs on
// the API's main thread: 10 takes about 0.1 s per sign-in here, 12 about 0.4 s.
const MIN_ROUNDS = config.env === 'test' ? 4 : 10;
const configuredRounds = Number(process.env.BCRYPT_ROUNDS ?? process.env.ENC_SECRET_KEY);
const PASSWORD_ROUNDS = Number.isInteger(configuredRounds) ? Math.min(15, Math.max(MIN_ROUNDS, configuredRounds)) : Math.max(MIN_ROUNDS, 10);

const encryptPassword = async (password: string) => {
  const encryptedPassword = await bcrypt.hash(password, PASSWORD_ROUNDS);
  return encryptedPassword;
};

const isPasswordMatch = async (password: string, userPassword: string) => {

  return bcrypt.compare(password, userPassword);
};

/** True for a hash made with a lower cost than new ones get (rehash it at the next sign-in). */
const passwordNeedsRehash = (hash: string | null | undefined): boolean => {
  if (!hash) return false;
  try {
    return bcrypt.getRounds(hash) < PASSWORD_ROUNDS;
  } catch {
    return false;
  }
};

export default { encryptPassword, isPasswordMatch, passwordNeedsRehash };
