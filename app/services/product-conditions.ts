export const CONDITION_FIELDS = [
  { label: "Tag", value: "tag" },
  { label: "Product type", value: "productType" },
  { label: "Vendor", value: "vendor" },
  { label: "Collection", value: "collection" },
  { label: "Product title", value: "title" },
  { label: "SKU", value: "sku" },
  { label: "Inventory stock", value: "inventory" },
  { label: "Main price", value: "price" },
  { label: "Compare-at price", value: "compareAtPrice" },
  { label: "Product status", value: "status" },
] as const;

export type ConditionField = (typeof CONDITION_FIELDS)[number]["value"];
export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than"
  | "greater_or_equal"
  | "less_or_equal";
export interface ProductCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
  label?: string;
}
export interface ProductFilters {
  conditions?: ProductCondition[];
  matchMode?: "all" | "any";
  // Older saved jobs remain executable.
  collectionId?: string;
  tags?: string[];
  titleKeyword?: string;
  productType?: string;
  vendor?: string;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
}

export const isNumericField = (field: ConditionField) =>
  ["price", "compareAtPrice", "inventory"].includes(field);
export const isChoiceField = (field: ConditionField) =>
  ["tag", "vendor", "productType", "collection", "status"].includes(field);

export function conditionOperators(
  field: ConditionField,
): { label: string; value: ConditionOperator }[] {
  const equality: { label: string; value: ConditionOperator }[] = [
    { label: "is equal to", value: "equals" },
    { label: "is not equal to", value: "not_equals" },
  ];
  if (isNumericField(field))
    return [
      ...equality,
      { label: "is higher than", value: "greater_than" },
      { label: "is less than", value: "less_than" },
      { label: "is higher than or equal to", value: "greater_or_equal" },
      { label: "is less than or equal to", value: "less_or_equal" },
    ];
  if (field === "title" || field === "sku")
    return [
      ...equality,
      { label: "contains", value: "contains" },
      { label: "does not contain", value: "not_contains" },
    ];
  return equality;
}

export function validateFilters(filters: ProductFilters): string[] {
  const errors: string[] = [];
  if (filters.matchMode && !["all", "any"].includes(filters.matchMode))
    errors.push("Choose all or any conditions.");
  if (filters.conditions === undefined) return errors;
  if (!Array.isArray(filters.conditions) || filters.conditions.length > 50)
    return ["Use a maximum of 50 conditions."];
  filters.conditions.forEach((condition, index) => {
    const prefix = `Condition ${index + 1}: `;
    if (
      !condition ||
      !CONDITION_FIELDS.some((f) => f.value === condition.field)
    ) {
      errors.push(prefix + "choose a valid field.");
      return;
    }
    if (
      !conditionOperators(condition.field).some(
        (o) => o.value === condition.operator,
      )
    )
      errors.push(prefix + "choose a valid operator.");
    if (typeof condition.value !== "string" || !condition.value.trim())
      errors.push(prefix + "enter or select a value.");
    else if (
      isNumericField(condition.field) &&
      (!Number.isFinite(Number(condition.value)) ||
        (condition.field !== "inventory" && Number(condition.value) < 0))
    )
      errors.push(prefix + "enter a valid number.");
    else if (
      condition.field === "collection" &&
      !/^gid:\/\/shopify\/Collection\/\d+$/.test(condition.value)
    )
      errors.push(prefix + "select an available collection.");
    else if (
      condition.field === "status" &&
      !["ACTIVE", "DRAFT", "ARCHIVED"].includes(condition.value)
    )
      errors.push(prefix + "select a valid status.");
  });
  return errors;
}

export interface FilterableVariant {
  price: string;
  compareAtPrice: string | null;
  productTitle: string;
  sku: string | null;
  inventoryQuantity: number | null;
  tags?: string[];
  vendor?: string;
  productType?: string;
  status?: string;
  collectionIds?: string[];
}

function matchesCondition(
  variant: FilterableVariant,
  condition: ProductCondition,
): boolean {
  const { field, operator, value } = condition;
  if (isNumericField(field)) {
    const raw =
      field === "inventory"
        ? variant.inventoryQuantity
        : variant[field as "price" | "compareAtPrice"];
    // An absent compare-at price is not a zero price.
    if (raw === null) return operator === "not_equals";
    const actual = Number(raw);
    const expected = Number(value);
    switch (operator) {
      case "equals":
        return actual === expected;
      case "not_equals":
        return actual !== expected;
      case "greater_than":
        return actual > expected;
      case "less_than":
        return actual < expected;
      case "greater_or_equal":
        return actual >= expected;
      case "less_or_equal":
        return actual <= expected;
      default:
        return false;
    }
  }
  const raw =
    field === "tag"
      ? (variant.tags ?? [])
      : field === "collection"
        ? (variant.collectionIds ?? [])
        : [
            field === "title"
              ? variant.productTitle
              : field === "sku"
                ? (variant.sku ?? "")
                : (variant[field as "vendor" | "productType" | "status"] ?? ""),
          ];
  const expected = value.trim().toLocaleLowerCase();
  const contains = operator === "contains" || operator === "not_contains";
  const found = raw.some((v) =>
    contains
      ? v.toLocaleLowerCase().includes(expected)
      : v.toLocaleLowerCase() === expected,
  );
  return operator === "not_equals" || operator === "not_contains"
    ? !found
    : found;
}

export function matchesFilters(
  variant: FilterableVariant,
  filters: ProductFilters,
): boolean {
  if (filters.conditions !== undefined) {
    if (!filters.conditions.length) return true;
    return filters.matchMode === "any"
      ? filters.conditions.some((c) => matchesCondition(variant, c))
      : filters.conditions.every((c) => matchesCondition(variant, c));
  }
  const legacy: ProductCondition[] = [];
  if (filters.collectionId)
    legacy.push({
      field: "collection",
      operator: "equals",
      value: filters.collectionId,
    });
  if (filters.titleKeyword)
    legacy.push({
      field: "title",
      operator: "contains",
      value: filters.titleKeyword,
    });
  for (const field of ["vendor", "productType", "status"] as const) {
    if (filters[field])
      legacy.push({ field, operator: "equals", value: filters[field]! });
  }
  return (
    legacy.every((c) => matchesCondition(variant, c)) &&
    (!filters.tags?.length ||
      filters.tags.some((tag) =>
        matchesCondition(variant, {
          field: "tag",
          operator: "equals",
          value: tag,
        }),
      ))
  );
}

export function describeConditions(filters: ProductFilters): string[] {
  return (filters.conditions ?? []).map((condition) => {
    const field =
      CONDITION_FIELDS.find((f) => f.value === condition.field)?.label ??
      condition.field;
    const operator =
      conditionOperators(condition.field).find(
        (o) => o.value === condition.operator,
      )?.label ?? condition.operator;
    return `${field} ${operator} “${condition.label || condition.value}”`;
  });
}
