import {
  matchesFilters,
  validateFilters,
  type FilterableVariant,
  type ProductFilters,
} from "./product-conditions.ts";
export type { ProductFilters } from "./product-conditions";

export interface VariantData extends FilterableVariant {
  id: string;
  numericId: string;
  title: string;
  productId: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
}

export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

async function queryData(
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const response = await admin.graphql(query, { variables });
  const result = await response.json();
  if (result.errors?.length)
    throw new Error(
      result.errors
        .map((error: { message: string }) => error.message)
        .join("; "),
    );
  if (!result.data)
    throw new Error("Shopify did not return catalog data. Please try again.");
  return result.data;
}

// Paginate variants directly so products with more than 100 variants are complete.
// Exact predicates avoid tokenized-search surprises for equality and negation.
const VARIANTS_QUERY = `#graphql
  query AdjustmentVariants($after: String) {
    productVariants(first: 100, after: $after) {
      nodes {
        id title price compareAtPrice sku inventoryQuantity
        image { url altText }
        product {
          id title tags vendor productType status
          featuredMedia { preview { image { url altText } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTION_MEMBERS_QUERY = `#graphql
  query AdjustmentCollectionMembers($id: ID!, $after: String) {
    collection(id: $id) {
      products(first: 250, after: $after) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function nextCursor(
  page: { hasNextPage: boolean; endCursor: string | null },
  previous: string | null,
): string | null {
  if (!page.hasNextPage) return null;
  if (!page.endCursor || page.endCursor === previous)
    throw new Error(
      "Shopify catalog pagination could not continue. Please try again.",
    );
  return page.endCursor;
}

export async function fetchAllFilteredVariants(
  admin: AdminGraphqlClient,
  filters: ProductFilters,
): Promise<VariantData[]> {
  const errors = validateFilters(filters);
  if (errors.length) throw new Error(errors.join(" "));
  const collectionIds = new Set(
    (filters.conditions ?? [])
      .filter((c) => c.field === "collection")
      .map((c) => c.value),
  );
  if (filters.collectionId) collectionIds.add(filters.collectionId);
  const memberships = new Map<string, Set<string>>();
  for (const id of collectionIds) {
    const productIds = new Set<string>();
    let after: string | null = null;
    do {
      const data = await queryData(admin, COLLECTION_MEMBERS_QUERY, {
        id,
        after,
      });
      if (!data.collection)
        throw new Error(
          "A selected collection no longer exists. Update your conditions.",
        );
      const connection = data.collection.products;
      connection.nodes.forEach((product: { id: string }) =>
        productIds.add(product.id),
      );
      after = nextCursor(connection.pageInfo, after);
    } while (after);
    memberships.set(id, productIds);
  }

  const variants: VariantData[] = [];
  let after: string | null = null;
  do {
    const data = await queryData(admin, VARIANTS_QUERY, { after });
    const connection = data.productVariants;
    if (!connection) throw new Error("Unable to load product variants.");
    for (const node of connection.nodes) {
      const product = node.product;
      const image = node.image ?? product.featuredMedia?.preview?.image;
      const variant: VariantData = {
        id: node.id,
        numericId: node.id.split("/").pop()!,
        title: node.title,
        price: node.price,
        compareAtPrice: node.compareAtPrice,
        sku: node.sku,
        inventoryQuantity: node.inventoryQuantity,
        productId: product.id,
        productTitle: product.title,
        tags: product.tags,
        vendor: product.vendor,
        productType: product.productType,
        status: product.status,
        collectionIds: [...memberships]
          .filter(([, ids]) => ids.has(product.id))
          .map(([id]) => id),
        imageUrl: image?.url ?? null,
        imageAlt: image?.altText ?? product.title,
      };
      if (matchesFilters(variant, filters)) variants.push(variant);
    }
    after = nextCursor(connection.pageInfo, after);
  } while (after);
  return variants;
}

export interface FilterOption {
  label: string;
  value: string;
}
export interface FilterOptions {
  tag: FilterOption[];
  productType: FilterOption[];
  vendor: FilterOption[];
  collection: FilterOption[];
  status: FilterOption[];
}

async function fetchStringOptions(
  admin: AdminGraphqlClient,
  field: "productTags" | "productTypes" | "productVendors",
): Promise<FilterOption[]> {
  // field is a fixed allowlist, never merchant input.
  const query = `query AdjustmentOptions($after: String) {
    ${field}(first: 250, after: $after) { nodes pageInfo { hasNextPage endCursor } }
  }`;
  let after: string | null = null;
  const values = new Set<string>();
  do {
    const data = await queryData(admin, query, { after });
    const connection = data[field];
    if (!connection) throw new Error("Unable to load filter options.");
    connection.nodes.forEach((value: string) => {
      if (value.trim()) values.add(value);
    });
    after = nextCursor(connection.pageInfo, after);
  } while (after);
  return [...values]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ label: value, value }));
}

async function fetchCollectionOptions(
  admin: AdminGraphqlClient,
): Promise<FilterOption[]> {
  const options: FilterOption[] = [];
  let after: string | null = null;
  do {
    const data = await queryData(
      admin,
      `query AdjustmentCollections($after: String) {
      collections(first: 250, after: $after) { nodes { id title } pageInfo { hasNextPage endCursor } }
    }`,
      { after },
    );
    data.collections.nodes.forEach(
      (collection: { id: string; title: string }) =>
        options.push({ label: collection.title, value: collection.id }),
    );
    after = nextCursor(data.collections.pageInfo, after);
  } while (after);
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchFilterOptions(
  admin: AdminGraphqlClient,
): Promise<FilterOptions> {
  const [tag, productType, vendor, collection] = await Promise.all([
    fetchStringOptions(admin, "productTags"),
    fetchStringOptions(admin, "productTypes"),
    fetchStringOptions(admin, "productVendors"),
    fetchCollectionOptions(admin),
  ]);
  return {
    tag,
    productType,
    vendor,
    collection,
    status: [
      { label: "Active", value: "ACTIVE" },
      { label: "Draft", value: "DRAFT" },
      { label: "Archived", value: "ARCHIVED" },
    ],
  };
}

export async function fetchShopCurrency(
  admin: AdminGraphqlClient,
): Promise<string> {
  const data = await queryData(
    admin,
    `query AdjustmentCurrency { shop { currencyCode } }`,
  );
  return data.shop.currencyCode;
}
