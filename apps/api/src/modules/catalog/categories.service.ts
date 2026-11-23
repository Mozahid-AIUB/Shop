import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateCategoryInput, UpdateCategoryInput } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** তালিকায় যা লাগে শুধু তাই — `include` দিয়ে পুরো row টানা হয় না। */
const CATEGORY_FIELDS = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  sortOrder: true,
} as const;

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * পুরো গাছ এক query-তে — parent ধরে ধরে আলাদা query করলে N+1 হয়।
   * দুই স্তর বলে সব row একবারে এনে মেমরিতে সাজানো সবচেয়ে সস্তা।
   */
  async tree(): Promise<CategoryNode[]> {
    const all = await this.prisma.category.findMany({
      select: CATEGORY_FIELDS,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const children = new Map<string, CategoryNode[]>();
    const roots: CategoryNode[] = [];

    for (const row of all) {
      const node: CategoryNode = { ...row, children: [] };

      if (row.parentId) {
        const siblings = children.get(row.parentId) ?? [];
        siblings.push(node);
        children.set(row.parentId, siblings);
      } else {
        roots.push(node);
      }
    }

    for (const root of roots) {
      root.children = children.get(root.id) ?? [];
    }

    return roots;
  }

  async create(input: CreateCategoryInput): Promise<CategorySummary> {
    await this.assertDepthAllowed(input.parentId ?? null);

    try {
      return await this.prisma.category.create({
        data: {
          name: input.name,
          slug: input.slug,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
        select: CATEGORY_FIELDS,
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async update(id: string, input: UpdateCategoryInput): Promise<CategorySummary> {
    if (input.parentId !== undefined) {
      await this.assertDepthAllowed(input.parentId ?? null);

      // নিজের ভেতরে নিজেকে ঢোকালে গাছ চক্রে পড়ে যায়
      if (input.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
    }

    try {
      return await this.prisma.category.update({
        where: { id },
        data: input,
        select: CATEGORY_FIELDS,
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const [childCount, productCount] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.product.count({ where: { categoryId: id } }),
    ]);

    // cascade দিলে একটা ক্লিকে পুরো ক্যাটালগ উবে যেতে পারত
    if (childCount > 0 || productCount > 0) {
      throw new ConflictException(
        'Move or delete the products and sub-categories inside this category first',
      );
    }

    try {
      await this.prisma.category.delete({ where: { id } });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  /**
   * গাছ সর্বোচ্চ দুই স্তর। DB constraint দিয়ে গভীরতা বলা যায় না,
   * তাই parent-এর নিজের parent আছে কিনা দেখে আটকানো হয়।
   */
  private async assertDepthAllowed(parentId: string | null): Promise<void> {
    if (!parentId) {
      return;
    }

    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
      select: { parentId: true },
    });

    if (!parent) {
      throw new BadRequestException('Parent category not found');
    }

    if (parent.parentId) {
      throw new BadRequestException('Categories go only two levels deep');
    }
  }

  private translateWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new ConflictException('A category with this slug already exists');
      }

      if (error.code === 'P2025') {
        return new NotFoundException('Category not found');
      }
    }

    return error instanceof Error ? error : new Error('Unknown database error');
  }
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
}

export interface CategoryNode extends CategorySummary {
  children: CategoryNode[];
}
