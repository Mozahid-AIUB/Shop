import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CourierAccount, Prisma } from '@prisma/client';
import {
  COURIER_CREDENTIAL_FIELDS,
  type Courier,
  type CourierAccountInput,
  type CourierAccountUpdate,
  type CourierAccountView,
} from '@shop/shared';
import { SecretBox } from '../../common/secret-box';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * কুরিয়ারের সেটআপ — **সব অ্যাডমিন প্যানেল থেকে**।
 *
 * **কেন DB-তে, `.env`-এ নয়:** এই কোড অন্য ব্যবসায়ীদের কাছেও যাবে।
 * key বদলাতে সার্ভারে SSH করে ফাইল এডিট করে রিস্টার্ট করতে হলে
 * তারা পারত না — আর key বদলানো নিয়মিত ঘটনা (কুরিয়ার rotate করে,
 * কর্মী বদলায়)।
 *
 * **key DB-তে এনক্রিপ্ট করা থাকে** (`SecretBox`)। DB backup,
 * `pg_dump`, বা শুধু read access — তিনটাই সাধারণ ঘটনা, আর কুরিয়ারের
 * key হাতে পেলে যে কেউ ব্যবসার অ্যাকাউন্ট দিয়ে পার্সেল পাঠাতে পারে।
 *
 * **key কখনো response-এ ফেরে না** — শুধু শেষ ৪ অক্ষর।
 */
@Injectable()
export class CourierAccountService {
  private readonly box: SecretBox;

  constructor(private readonly prisma: PrismaService) {
    this.box = new SecretBox(readMasterKey());
  }

  async list(): Promise<CourierAccountView[]> {
    const accounts = await this.prisma.courierAccount.findMany({ orderBy: { kind: 'asc' } });

    return accounts.map((account) => this.toView(account));
  }

  /**
   * অ্যাকাউন্ট তৈরি।
   *
   * **key ছাড়াও তৈরি করা যায়** — চুক্তি চলছে কিন্তু key এখনো
   * আসেনি, এই অবস্থা স্বাভাবিক। তখন `isActive` `false` থাকে আর
   * `assertReadyToActivate` চালু করতে দেয় না।
   */
  async create(input: CourierAccountInput): Promise<CourierAccountView> {
    const existing = await this.prisma.courierAccount.findUnique({ where: { kind: input.kind } });

    if (existing !== null) {
      throw new ConflictException(`${input.kind}-এর অ্যাকাউন্ট আগেই আছে`);
    }

    if (input.isActive) {
      this.assertReadyToActivate(input.kind, input.credentials);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const account = await tx.courierAccount.create({
        data: {
          kind: input.kind,
          label: input.label,
          credentials: this.sealCredentials(input.credentials),
          webhookSecret: input.webhookSecret === null ? null : this.box.seal(input.webhookSecret),
          isActive: input.isActive,
          isDefault: input.isDefault,
          isSandbox: input.isSandbox,
        },
      });

      if (input.isDefault) {
        await this.clearOtherDefaults(tx, account.id);
      }

      return account;
    });

    return this.toView(created);
  }

  /**
   * অ্যাকাউন্ট বদলানো।
   *
   * **যা পাঠানো হয়নি তা অপরিবর্তিত থাকে।** `credentials` না
   * পাঠালে পুরোনো key থেকে যায় — নইলে শুধু নাম বদলাতে গিয়ে
   * অ্যাডমিন key মুছে ফেলত আর পরের অর্ডার পাঠানোর সময় জানত।
   *
   * `kind` বদলানো যায় না — schema-তেই মাঠটা নেই।
   */
  async update(id: string, input: CourierAccountUpdate): Promise<CourierAccountView> {
    const account = await this.prisma.courierAccount.findUnique({ where: { id } });

    if (account === null) {
      throw new NotFoundException('কুরিয়ার অ্যাকাউন্ট পাওয়া যায়নি');
    }

    /**
     * চালু করার সময় key আছে কিনা যাচাই।
     *
     * নতুন key সাথে এলে সেটা দেখা হয়, নইলে DB-তে যা আছে।
     * না দেখলে key-হীন অ্যাকাউন্ট চালু হয়ে ডিফল্ট হয়ে বসত, আর
     * প্রতিটা অর্ডার পাঠানোর চেষ্টা ব্যর্থ হতো — অথচ প্যানেলে সব
     * ঠিক দেখাত।
     */
    if (input.isActive === true) {
      const credentials =
        input.credentials === undefined
          ? this.openCredentials(account.credentials)
          : input.credentials;

      this.assertReadyToActivate(account.kind, credentials);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.courierAccount.update({
        where: { id },
        data: {
          label: input.label,
          credentials:
            input.credentials === undefined
              ? undefined
              : this.sealCredentials(input.credentials),
          webhookSecret: this.sealOptionalSecret(input.webhookSecret),
          isActive: input.isActive,
          isDefault: input.isDefault,
          isSandbox: input.isSandbox,
        },
      });

      if (input.isDefault === true) {
        await this.clearOtherDefaults(tx, id);
      }

      return next;
    });

    return this.toView(updated);
  }

  /**
   * অ্যাকাউন্ট মোছা।
   *
   * **পার্সেল পাঠানো হয়ে গেলে মোছা যায় না** — `Shipment.account`
   * relation-এ `onDelete: Restrict`, কিন্তু DB-র ত্রুটি অ্যাডমিনকে
   * দেখানোর মতো নয়। বন্ধ করতে `isActive: false` যথেষ্ট।
   *
   * `MANUAL` কখনো মোছা যায় না: ওটা migration-এ আসে আর key ছাড়া
   * চলে, তাই শেষ ভরসা। মুছে ফেললে key-হীন দোকান কিছুই পাঠাতে
   * পারত না।
   */
  async remove(id: string): Promise<void> {
    const account = await this.prisma.courierAccount.findUnique({
      where: { id },
      select: { kind: true, _count: { select: { shipments: true } } },
    });

    if (account === null) {
      throw new NotFoundException('কুরিয়ার অ্যাকাউন্ট পাওয়া যায়নি');
    }

    if (account.kind === 'MANUAL') {
      throw new BadRequestException('নিজের ডেলিভারি মোছা যায় না — বন্ধ করতে নিষ্ক্রিয় করুন');
    }

    if (account._count.shipments > 0) {
      throw new BadRequestException(
        'এই কুরিয়ারে পার্সেল পাঠানো হয়েছে, মোছা যাবে না — বন্ধ করতে নিষ্ক্রিয় করুন',
      );
    }

    await this.prisma.courierAccount.delete({ where: { id } });
  }

  /**
   * পার্সেল পাঠানোর জন্য অ্যাকাউন্ট বের করা — **key খোলা অবস্থায়**।
   *
   * এটা শুধু ভেতরের ব্যবহারের জন্য; কোনো controller সরাসরি এর ফল
   * ফেরত দেয় না, নইলে key response-এ চলে যেত।
   */
  async resolveForDispatch(
    kind: Courier | undefined,
  ): Promise<{ account: CourierAccount; credentials: Record<string, string> }> {
    const account =
      kind === undefined
        ? await this.prisma.courierAccount.findFirst({ where: { isDefault: true, isActive: true } })
        : await this.prisma.courierAccount.findUnique({ where: { kind } });

    if (account === null) {
      throw new BadRequestException(
        kind === undefined
          ? 'কোনো ডিফল্ট কুরিয়ার সেট করা নেই — প্যানেল থেকে বাছুন'
          : 'এই কুরিয়ার সেটআপ করা নেই',
      );
    }

    if (!account.isActive) {
      throw new BadRequestException(`${account.label} এখন বন্ধ আছে`);
    }

    const credentials = this.openCredentials(account.credentials);

    this.assertReadyToActivate(account.kind, credentials);

    return { account, credentials: credentials ?? {} };
  }

  /** webhook যাচাইয়ের জন্য — secret খোলা অবস্থায়। */
  async findForWebhook(
    kind: Courier,
  ): Promise<{ account: CourierAccount; webhookSecret: string | null } | null> {
    const account = await this.prisma.courierAccount.findUnique({ where: { kind } });

    if (account === null) {
      return null;
    }

    return {
      account,
      webhookSecret: account.webhookSecret === null ? null : this.box.open(account.webhookSecret),
    };
  }

  /**
   * চালু করার আগে দরকারি মাঠ আছে কিনা।
   *
   * `MANUAL`-এ কিছুই লাগে না, তাই সবসময় পাস করে।
   */
  private assertReadyToActivate(
    kind: Courier,
    credentials: Record<string, string> | null | undefined,
  ): void {
    const required = COURIER_CREDENTIAL_FIELDS[kind];

    if (required.length === 0) {
      return;
    }

    const given = credentials ?? {};
    const missing = required.filter((field) => (given[field] ?? '') === '');

    if (missing.length > 0) {
      throw new BadRequestException(
        `${kind} চালু করতে এগুলো দরকার: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * ডিফল্ট ঠিক একটাই।
   *
   * দুটো থাকলে `findFirst` যেকোনো একটা তুলে আনত, আর কোন কুরিয়ারে
   * পার্সেল গেল সেটা অনুমানের ব্যাপার হয়ে যেত।
   */
  private clearOtherDefaults(tx: Prisma.TransactionClient, keepId: string): Promise<unknown> {
    return tx.courierAccount.updateMany({
      where: { id: { not: keepId }, isDefault: true },
      data: { isDefault: false },
    });
  }

  private sealCredentials(credentials: Record<string, string> | null): string | null {
    return credentials === null ? null : this.box.seal(JSON.stringify(credentials));
  }

  /**
   * `undefined` = পাঠানো হয়নি, অপরিবর্তিত থাকবে।
   * `null` = মুছে ফেলতে বলা হয়েছে।
   */
  private sealOptionalSecret(secret: string | null | undefined): string | null | undefined {
    if (secret === undefined) {
      return undefined;
    }

    return secret === null ? null : this.box.seal(secret);
  }

  private openCredentials(sealed: string | null): Record<string, string> | null {
    if (sealed === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(this.box.open(sealed));

    /**
     * আকার যাচাই করা হয় কারণ এটা DB থেকে আসা ডেটা, আর কেউ হাতে
     * row বদলে থাকতে পারে। `as` দিয়ে জোর করে ধরে নিলে পরে
     * adapter-এ অদ্ভুত ত্রুটি হতো।
     */
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BadRequestException('কুরিয়ারের credential নষ্ট হয়ে গেছে — আবার বসান');
    }

    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * প্যানেলে দেখানোর আকার — **key ছাড়া**।
   *
   * `credentialHints`-এ শুধু শেষ ৪ অক্ষর, যাতে অ্যাডমিন মেলাতে
   * পারে "হ্যাঁ, এটাই বসিয়েছিলাম"। এতটুকু ফাঁস হলেও কিছু করা যায় না।
   */
  private toView(account: CourierAccount): CourierAccountView {
    const credentials = this.openCredentials(account.credentials) ?? {};
    const required = COURIER_CREDENTIAL_FIELDS[account.kind];

    const credentialHints: Record<string, string> = {};

    for (const [field, value] of Object.entries(credentials)) {
      credentialHints[field] = SecretBox.mask(value);
    }

    return {
      id: account.id,
      kind: account.kind,
      label: account.label,
      isActive: account.isActive,
      isDefault: account.isDefault,
      isSandbox: account.isSandbox,
      credentialHints,
      missingFields: required.filter((field) => (credentials[field] ?? '') === ''),
      hasWebhookSecret: account.webhookSecret !== null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }
}

/**
 * এনক্রিপশনের মূল চাবি — **`.env`-এ, DB-তে নয়**।
 *
 * DB-তে রাখলে তালা আর চাবি একই বাক্সে থাকত, আর এনক্রিপশনের কোনো
 * মানেই হতো না।
 *
 * **চাবি না থাকলে অ্যাপ চালু হয় না** (production-এ), ইচ্ছাকৃতভাবে।
 * একটা ফাঁকা default বসিয়ে দিলে সব দোকান একই চাবি ব্যবহার করত, আর
 * একজনের DB ফাঁস হলে সবার key খোলা যেত।
 *
 * টেস্ট আর dev-এ একটা নির্দিষ্ট চাবি ব্যবহার হয় যাতে `npm run dev`
 * চালাতে কিছু সেটআপ না লাগে — কিন্তু সেটা `NODE_ENV=production`-এ
 * কাজ করে না।
 */
const DEV_KEY = 'd'.repeat(64);

function readMasterKey(): string {
  const configured = process.env.COURIER_SECRET_KEY;

  if (configured !== undefined && configured !== '') {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'COURIER_SECRET_KEY is required in production — generate one with: openssl rand -hex 32',
    );
  }

  return DEV_KEY;
}
