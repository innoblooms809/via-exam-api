import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// The evaluation API for partners (other platforms that send their own papers and sheets).
//
//   PartnerApiKey      one key per partner integration. Only a hash of the secret is stored;
//                      the full key ("vx_live_<keyId>_<secret>") is shown once, when created.
//                      The webhook signing secret is stored sealed (queue/sealed.ts).
//   PartnerEvaluation  one evaluation request: the paper, the student's answers (text or the
//                      file, dropped once evaluated), its status and result. It runs through the
//                      same OCR / AI queues as the schools' own sheets, so partner traffic can
//                      never overload the GPUs behind them.

export const PARTNER_SCOPES = ["evaluations:write", "evaluations:read"] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

interface PartnerApiKeyAttributes {
  id: number;
  keyId: string;
  name: string;
  keyHash: string;
  scopes: PartnerScope[];
  status: "active" | "revoked";
  /** Requests per minute this key may make. */
  rateLimitPerMinute: number;
  /** Evaluations of this key that may wait or run at once. */
  maxQueued: number;
  webhookUrl: string | null;
  webhookSecretSealed: string;
  createdBy: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PartnerApiKeyCreation
  extends Optional<PartnerApiKeyAttributes, "id" | "scopes" | "status" | "rateLimitPerMinute" | "maxQueued" | "webhookUrl" | "createdBy" | "lastUsedAt" | "revokedAt"> {}

export class PartnerApiKey extends Model<PartnerApiKeyAttributes, PartnerApiKeyCreation> implements PartnerApiKeyAttributes {
  public id!: number;
  public keyId!: string;
  public name!: string;
  public keyHash!: string;
  public scopes!: PartnerScope[];
  public status!: "active" | "revoked";
  public rateLimitPerMinute!: number;
  public maxQueued!: number;
  public webhookUrl!: string | null;
  public webhookSecretSealed!: string;
  public createdBy!: string | null;
  public lastUsedAt!: Date | null;
  public revokedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PartnerApiKey.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    keyId: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    keyHash: { type: DataTypes.STRING(64), allowNull: false },
    scopes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [...PARTNER_SCOPES] },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "active" },
    rateLimitPerMinute: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
    maxQueued: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 200 },
    webhookUrl: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    webhookSecretSealed: { type: DataTypes.TEXT, allowNull: false },
    createdBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    revokedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  },
  { sequelize, tableName: "viaexam_partner_api_keys", modelName: "PartnerApiKey", timestamps: true }
);

export type PartnerEvaluationStatus = "queued" | "processing" | "succeeded" | "failed" | "canceled";

interface PartnerEvaluationAttributes {
  id: number;
  evaluationId: string;
  keyId: string;
  externalId: string | null;
  idempotencyKey: string | null;
  requestHash: string;
  status: PartnerEvaluationStatus;
  paper: any;
  answerKeyText: string | null;
  studentText: string | null;
  /** The student's sheet (PDF / image) until it has been evaluated. */
  studentFile: Buffer | null;
  studentFileName: string | null;
  studentId: string | null;
  metadata: any;
  webhookUrl: string | null;
  result: any;
  error: string | null;
  errorCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PartnerEvaluationCreation
  extends Optional<
    PartnerEvaluationAttributes,
    | "id" | "externalId" | "idempotencyKey" | "status" | "answerKeyText" | "studentText" | "studentFile" | "studentFileName"
    | "studentId" | "metadata" | "webhookUrl" | "result" | "error" | "errorCode" | "startedAt" | "finishedAt"
  > {}

export class PartnerEvaluation extends Model<PartnerEvaluationAttributes, PartnerEvaluationCreation> implements PartnerEvaluationAttributes {
  public id!: number;
  public evaluationId!: string;
  public keyId!: string;
  public externalId!: string | null;
  public idempotencyKey!: string | null;
  public requestHash!: string;
  public status!: PartnerEvaluationStatus;
  public paper!: any;
  public answerKeyText!: string | null;
  public studentText!: string | null;
  public studentFile!: Buffer | null;
  public studentFileName!: string | null;
  public studentId!: string | null;
  public metadata!: any;
  public webhookUrl!: string | null;
  public result!: any;
  public error!: string | null;
  public errorCode!: string | null;
  public startedAt!: Date | null;
  public finishedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PartnerEvaluation.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    evaluationId: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    keyId: { type: DataTypes.STRING(32), allowNull: false },
    externalId: { type: DataTypes.STRING(128), allowNull: true, defaultValue: null },
    idempotencyKey: { type: DataTypes.STRING(128), allowNull: true, defaultValue: null },
    requestHash: { type: DataTypes.STRING(64), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "queued" },
    paper: { type: DataTypes.JSONB, allowNull: false },
    answerKeyText: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    studentText: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    studentFile: { type: DataTypes.BLOB("long"), allowNull: true, defaultValue: null },
    studentFileName: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    studentId: { type: DataTypes.STRING(128), allowNull: true, defaultValue: null },
    metadata: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    webhookUrl: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    result: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    error: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    errorCode: { type: DataTypes.STRING(40), allowNull: true, defaultValue: null },
    startedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    finishedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_partner_evaluations",
    modelName: "PartnerEvaluation",
    timestamps: true,
    indexes: [
      { fields: ["keyId", "createdAt"] },
      { fields: ["keyId", "status"] },
      { name: "viaexam_partner_evaluations_idempotency", unique: true, fields: ["keyId", "idempotencyKey"] },
    ],
  }
);
