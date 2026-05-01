import bcrypt from 'bcryptjs';
import config from '../config/config';
import buffer from 'buffer';
import cryptox from 'crypto';
import crypto, { CipherGCM, CipherGCMTypes, DecipherGCM } from 'crypto';

const ENC_SECRET_KEY = process.env.ENC_SECRET_KEY ? +process.env.ENC_SECRET_KEY : 7;
const encryptPassword = async (password: string) => {
  const encryptedPassword = await bcrypt.hash(password, ENC_SECRET_KEY);
  return encryptedPassword;
};

const isPasswordMatch = async (password: string, userPassword: string) => {

  return bcrypt.compare(password, userPassword);
};

const algorithm = config.payment.ecnryption_method; // Use AES 256-bit encryption

// Generate a random 16-byte IV
// const key = crypto
//   .createHash('sha512')
//   .update(config.payment.secret_key)
//   .digest('hex')
//   .substring(0, 32) // Generate a random 32-byte key
// const iv = crypto
//   .createHash('sha512')
//   .update(config.payment.secret_iv)
//   .digest('hex')
//   .substring(0, 16)
// Generate a random 16-byte IV

// function encrypt(data:string) { // Function to encrypt data
//     let cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
//     let encrypted = cipher.update(data);
//     encrypted = Buffer.concat([encrypted, cipher.final()]);
//     return {
//         iv: iv.toString('hex'),
//         encryptedData: encrypted.toString('hex')
//     };
// }

// function decrypt(data:any) { // Function to decrypt data
//     let iv = Buffer.from(data.iv, 'hex');
//     let encryptedText = Buffer.from(data.encryptedData, 'hex');
//     let decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
//     let decrypted = decipher.update(encryptedText);
//     decrypted = Buffer.concat([decrypted, decipher.final()]);
//     return decrypted.toString();
// }

/**
 * Get encryption/decryption algorithm
 */
function getAlgorithm(): CipherGCMTypes {
  return 'aes-256-gcm';
}

/**
 * Get encrypted string prefix
 */
function getEncryptedPrefix(): string {
  return 'enc::';
}

/**
 * Derive 256 bit encryption key from password, using salt and iterations -> 32 bytes
 * @param password
 * @param salt
 * @param iterations
 */
function deriveKeyFromPassword(password: string, salt: Buffer, iterations: number): Buffer {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512');
}

function encryptAesGcm(plainText: string | object, password: string): string | undefined {
  try {
    if (typeof plainText === 'object') {
      plainText = JSON.stringify(plainText);
    } else {
      plainText = String(plainText);
    }

    const algorithm: CipherGCMTypes = getAlgorithm();

    // Generate random salt -> 64 bytes
    const salt = crypto.randomBytes(64);

    // Generate random initialization vector -> 16 bytes
    const iv = crypto.randomBytes(16);

    // Generate random count of iterations between 10.000 - 99.999 -> 5 bytes
    const iterations = Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000;

    // Derive encryption key
    const encryptionKey = deriveKeyFromPassword('', salt, Math.floor(iterations * 0.47 + 1337));

    // Create cipher
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: TS expects the wrong createCipher return type here
    const cipher: CipherGCM = crypto.createCipheriv(algorithm, encryptionKey, iv);

    // Update the cipher with data to be encrypted and close cipher
    const encryptedData = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);

    // Get authTag from cipher for decryption // 16 bytes
    const authTag = cipher.getAuthTag();

    // Join all data into single string, include requirements for decryption
    const output = Buffer.concat([
      salt,
      iv,
      authTag,
      Buffer.from(iterations.toString()),
      encryptedData
    ]).toString('hex');

    return output;
  } catch (error) {
    console.error('Encryption failed!');
    console.error(error);
    return void 0;
  }
}

// Demo implementation of using `aes-256-gcm` with node.js's `crypto` lib.
const aes256gcm = (key: any) => {
  const ALGO = 'aes-256-gcm';

  // encrypt returns base64-encoded ciphertext
  const encrypt = (str: string) => {
    // // The `iv` for a given key must be globally unique to prevent
    // // against forgery attacks. `randomBytes` is convenient for
    // // demonstration but a poor way to achieve this in practice.
    // //
    // // See: e.g. https://csrc.nist.gov/publications/detail/sp/800-38d/final
    // const iv = new Buffer(cryptox.randomBytes(12), 'utf8');
    // const cipher = cryptox.createCipheriv(ALGO, key, iv);
    // // Hint: Larger inputs (it's GCM, after all!) should use the stream API
    // let enc = cipher.update(str, 'utf8', 'base64');
    // enc += cipher.final('base64');
    // enc = enc?.replace('\n', '').replace('\r', '');
    // return [enc, iv, cipher.getAuthTag()];
  };

  // decrypt decodes base64-encoded ciphertext into a utf8-encoded string
  const decrypt = (enc: string, iv: string, authTag: any) => {
    const decipher = cryptox.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    let str = decipher.update(enc, 'base64', 'utf8');
    str += decipher.final('utf8');
    return str;
  };

  return {
    encrypt,
    decrypt
  };
};

export default{ encryptAesGcm, aes256gcm, encryptPassword,isPasswordMatch };
