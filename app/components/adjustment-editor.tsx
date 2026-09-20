import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Banner, BlockStack, Checkbox, Modal, Page } from "@shopify/polaris";
import {
  CONDITION_FIELDS,
  conditionOperators,
  describeConditions,
  isChoiceField,
  isNumericField,
  validateFilters,
  type ConditionField,
  type ProductCondition,
  type ProductFilters,
} from "../services/product-conditions";
import {
  calculateAdjustedPrice,
  describeAdjustment,
  formatPriceDisplay,
  summarizeGuardBreaches,
  validateRule,
  type AdjustmentRule,
  type PriceTarget,
  type RoundingMode,
} from "../services/price-calculator";
import {
  validateSubmission,
  type AdjustmentPreview,
  type AdjustmentSubmission,
} from "../services/adjustment-request";
import type { FilterOptions } from "../services/product-filter.server";
import styles from "./adjustment-editor.module.css";
import { SearchableConditionValue } from "./searchable-condition-value";

interface EditorProps {
  options: FilterOptions;
  currencyCode: string;
  isPro: boolean;
  preview?: AdjustmentPreview;
  errors?: string[];
  loadingPreview: boolean;
  applying: boolean;
  onPreview: (filters: ProductFilters) => void;
  onApply: (submission: AdjustmentSubmission) => void;
}

const OPERATIONS = [
  { value: "increase", label: "Increase" },
  { value: "decrease", label: "Decrease" },
  { value: "set", label: "Set to fixed price" },
  { value: "round", label: "Round prices" },
] as const;
const AMOUNT_TYPES = [
  { value: "percentage", label: "Percentage" },
  { value: "fixed", label: "Fixed amount" },
] as const;
const ROUNDING = [
  { value: ".99", label: "End in .99" },
  { value: ".95", label: "End in .95" },
  { value: ".00", label: "Nearest whole number (.00)" },
  { value: "nearest_10", label: "Nearest 10" },
];
const PAGE_SIZE = 50;

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 5.5h12M8 3h4l1 2.5H7L8 3ZM5.5 5.5l.8 11h7.4l.8-11M8.5 8v6M11.5 8v6" />
    </svg>
  );
}

export function AdjustmentEditor({
  options,
  currencyCode,
  isPro,
  preview,
  errors = [],
  loadingPreview,
  applying,
  onPreview,
  onApply,
}: EditorProps) {
  const navigate = useNavigate();
  const nextId = useRef(1);
  const onPreviewRef = useRef(onPreview);
  const [conditions, setConditions] = useState<
    (ProductCondition & { id: number })[]
  >([]);
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [campaignName, setCampaignName] = useState("");
  const [operation, setOperation] = useState<
    "increase" | "decrease" | "set" | "round"
  >("increase");
  const [amountType, setAmountType] = useState<"percentage" | "fixed">(
    "percentage",
  );
  const [value, setValue] = useState("");
  const [rounding, setRounding] = useState<RoundingMode>(".99");
  const [targets, setTargets] = useState<PriceTarget[]>(["price"]);
  const [enableGuards, setEnableGuards] = useState(false);
  const [floor, setFloor] = useState("1.00");
  const [ceiling, setCeiling] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [autoRevert, setAutoRevert] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [guardBypassed, setGuardBypassed] = useState(false);
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    onPreviewRef.current = onPreview;
  }, [onPreview]);

  const filters = useMemo<ProductFilters>(
    () => ({
      matchMode,
      conditions: conditions.map(({ id: _id, ...condition }) => condition),
    }),
    [conditions, matchMode],
  );
  const filtersKey = JSON.stringify(filters);
  const currentPreview = Boolean(preview && preview.filtersKey === filtersKey);
  const rule = useMemo<AdjustmentRule>(
    () => ({
      adjustmentType:
        operation === "set" || operation === "round" ? operation : amountType,
      adjustmentDirection: operation === "decrease" ? "decrease" : "increase",
      adjustmentValue:
        operation === "round" ? 0 : value.trim() ? Number(value) : NaN,
      roundingMode: operation === "round" ? rounding : "none",
      compareAtMode: "unchanged",
      priceTargets: targets,
      minPriceFloor: enableGuards && floor.trim() ? Number(floor) : null,
      maxPriceCeiling: enableGuards && ceiling.trim() ? Number(ceiling) : null,
    }),
    [operation, amountType, value, rounding, targets, enableGuards, floor, ceiling],
  );
  const ruleKey = JSON.stringify(rule);
  const ruleErrors = validateRule(rule);
  const validRule = ruleErrors.length === 0;
  const variants = preview?.variants ?? [];
  const calculations = useMemo(
    () =>
      validRule
        ? variants.map((variant) =>
            calculateAdjustedPrice(variant.price, variant.compareAtPrice, rule),
          )
        : [],
    [variants, rule, validRule],
  );
  const changedCount = calculations.filter(
    (calculation) => calculation.priceChanged,
  ).length;
  const guards = summarizeGuardBreaches(calculations);
  const productCount = useMemo(
    () => new Set(variants.map((variant) => variant.productId)).size,
    [variants],
  );
  const pages = Math.max(1, Math.ceil(variants.length / PAGE_SIZE));
  const visibleVariants = variants.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const busy = loadingPreview || applying;
  const canApply =
    currentPreview &&
    validRule &&
    changedCount > 0 &&
    !busy;
  const money = (price: string | null) =>
    price === null ? "—" : formatPriceDisplay(price, currencyCode);
  const missingCompareAt =
    targets.includes("compareAtPrice") &&
    operation !== "set" &&
    variants.some((variant) => variant.compareAtPrice === null);

  useEffect(() => {
    setPage(1);
  }, [preview]);
  useEffect(() => {
    // An empty condition list deliberately previews the entire catalog. Once a
    // complete condition is chosen, the same automatic request refreshes the
    // table with only matching variants.
    if (validateFilters(filters).length) return;
    const timer = window.setTimeout(() => {
      setConfirmOpen(false);
      onPreviewRef.current(filters);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filtersKey]);
  useEffect(() => {
    setGuardBypassed(false);
    setConfirmOpen(false);
    setLocalErrors([]);
  }, [
    filtersKey,
    ruleKey,
    schedule,
    start,
    end,
    autoRevert,
    campaignName,
    preview?.fingerprint,
  ]);

  function updateCondition(id: number, patch: Partial<ProductCondition>) {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === id ? { ...condition, ...patch } : condition,
      ),
    );
  }
  function toggleTarget(target: PriceTarget) {
    setTargets((current) =>
      current.includes(target)
        ? current.filter((item) => item !== target)
        : [...current, target],
    );
  }
  function submission(): AdjustmentSubmission {
    const iso = (date: string) =>
      date && Number.isFinite(new Date(date).getTime())
        ? new Date(date).toISOString()
        : null;
    return {
      campaignName: campaignName.trim(),
      filters,
      rule,
      previewFingerprint: preview?.fingerprint ?? "",
      guardBypassed,
      scheduledStartAt: schedule ? iso(start) : null,
      scheduledEndAt: schedule ? iso(end) : null,
      autoRevert: schedule && autoRevert,
    };
  }
  function review() {
    const validation = validateSubmission(submission(), isPro);
    if (schedule && !start)
      validation.push("Choose a sale start date and time.");
    setLocalErrors(validation);
    if (!validation.length && canApply) setConfirmOpen(true);
  }

  return (
    <Page
      fullWidth
      title="New price adjustment"
      subtitle="Find the right products, choose an action, and review every price before applying."
      backAction={{ onAction: () => navigate("/app") }}
    >
      <div className={styles.editor}>
        {[...errors, ...localErrors].length > 0 && (
          <Banner title="Please review your adjustment" tone="critical">
            <ul>
              {[...new Set([...errors, ...localErrors])].map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </Banner>
        )}

        <section className={styles.card} aria-labelledby="campaign-heading">
          <label className={styles.campaignInput}>
            <span id="campaign-heading">Campaign name</span>
            <input
              type="text"
              maxLength={120}
              placeholder="e.g. Holiday sale 2026"
              value={campaignName}
              onChange={(event) => setCampaignName(event.target.value)}
            />
          </label>
          <p className={styles.hint}>
            Use a clear name to find this adjustment in your audit history.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="conditions-heading">
          <div className={styles.sectionHeading}>
            <h2 id="conditions-heading">Conditions</h2>
            <span className={styles.pill}>
              {conditions.length}{" "}
              {conditions.length === 1 ? "condition" : "conditions"}
            </span>
          </div>
          {conditions.length > 1 && <fieldset className={styles.matchRow}>
            <legend className={styles.srOnly}>How products should match</legend>
            <span>Products must match:</span>
            <label>
              <input
                type="radio"
                name="match-mode"
                checked={matchMode === "all"}
                onChange={() => setMatchMode("all")}
              />{" "}
              all conditions
            </label>
            <label>
              <input
                type="radio"
                name="match-mode"
                checked={matchMode === "any"}
                onChange={() => setMatchMode("any")}
              />{" "}
              any condition
            </label>
          </fieldset>}
          <div className={styles.conditionList}>
            {conditions.map((condition, index) => (
              <div className={styles.conditionRow} key={condition.id}>
                <label>
                  <span className={styles.srOnly}>
                    Condition {index + 1} field
                  </span>
                  <select
                    value={condition.field}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        field: event.target.value as ConditionField,
                        operator: "equals",
                        value: "",
                        label: undefined,
                      })
                    }
                  >
                    {CONDITION_FIELDS.map((field) => (
                      <option key={field.value} value={field.value}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={styles.srOnly}>
                    Condition {index + 1} operator
                  </span>
                  <select
                    value={condition.operator}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        operator: event.target
                          .value as ProductCondition["operator"],
                      })
                    }
                  >
                    {conditionOperators(condition.field).map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {operator.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.conditionValue}>
                  {isChoiceField(condition.field) ? (
                    <SearchableConditionValue
                      fieldLabel={
                        CONDITION_FIELDS.find(
                          (field) => field.value === condition.field,
                        )!.label
                      }
                      key={`${condition.id}-${condition.field}`}
                      condition={condition}
                      index={index}
                      options={options[condition.field as keyof FilterOptions]}
                      onChange={(newValue, label) =>
                        updateCondition(condition.id, {
                          value: newValue,
                          label,
                        })
                      }
                    />
                  ) : (
                    <label>
                      <span className={styles.srOnly}>
                        Condition {index + 1} value
                      </span>
                      <input
                        type={
                          isNumericField(condition.field) ? "number" : "text"
                        }
                        step={condition.field === "inventory" ? "1" : "any"}
                        placeholder={
                          isNumericField(condition.field)
                            ? "Enter a number…"
                            : `Enter ${condition.field === "title" ? "product title" : "SKU"}…`
                        }
                        value={condition.value}
                        onChange={(event) =>
                          updateCondition(condition.id, {
                            value: event.target.value,
                          })
                        }
                      />
                    </label>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.deleteButton}
                  aria-label={`Remove condition ${index + 1}`}
                  onClick={() =>
                    setConditions((current) =>
                      current.filter((item) => item.id !== condition.id),
                    )
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
            {!conditions.length && (
              <p className={styles.hint}>
                No conditions: all products and variants will be included.
              </p>
            )}
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={conditions.length >= 50}
            onClick={() =>
              setConditions((current) => [
                ...current,
                {
                  id: nextId.current++,
                  field: "tag",
                  operator: "equals",
                  value: "",
                },
              ])
            }
          >
            <span aria-hidden="true">＋</span>{" "}
            {conditions.length ? "Add another filter" : "Add a filter"}
          </button>
        </section>

        <section
          className={`${styles.card} ${styles.actionCard}`}
          aria-label="Price action"
        >
          <div className={styles.actionControls}>
            <label className={styles.actionSelect}>
              <span>Price action</span>
              <select
                value={operation}
                onChange={(event) =>
                  setOperation(
                    event.target.value as
                      | "increase"
                      | "decrease"
                      | "set"
                      | "round",
                  )
                }
              >
                {OPERATIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {(operation === "increase" || operation === "decrease") && (
              <label className={styles.amountTypeSelect}>
                <span>Adjustment</span>
                <select
                  value={amountType}
                  onChange={(event) =>
                    setAmountType(event.target.value as "percentage" | "fixed")
                  }
                >
                  {AMOUNT_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {operation === "round" ? (
              <label className={styles.roundSelect}>
                <span>Rounding</span>
                <select
                  value={rounding}
                  onChange={(event) =>
                    setRounding(event.target.value as RoundingMode)
                  }
                >
                  {ROUNDING.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className={styles.amountInput}>
                <span>
                  {operation === "set" ? "New price" : "Value"}{" "}
                  {operation !== "set" && amountType === "percentage"
                    ? "(%)"
                    : `(${currencyCode})`}
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 10"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
            )}
            <fieldset className={styles.targets}>
              <legend className={styles.srOnly}>Price fields to update</legend>
              <label>
                <input
                  type="checkbox"
                  checked={targets.includes("price")}
                  onChange={() => toggleTarget("price")}
                />{" "}
                Main Price
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={targets.includes("compareAtPrice")}
                  onChange={() => toggleTarget("compareAtPrice")}
                />{" "}
                Compare-at Price
              </label>
            </fieldset>
          </div>
          <div className={styles.actionButtons}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!canApply}
              onClick={review}
            >
              {applying
                ? "Applying…"
                : schedule
                  ? `Schedule ${changedCount || ""} ${changedCount === 1 ? "Variant" : "Variants"}`
                  : `Apply Changes${currentPreview && changedCount ? ` to ${changedCount} ${changedCount === 1 ? "Variant" : "Variants"}` : ""}`}
            </button>
          </div>
        </section>

        {preview && !currentPreview && (
          <Banner tone="warning">
            <p>
              Complete the filter value to refresh the product list. Changes
              are applied automatically once a filter is valid.
            </p>
          </Banner>
        )}
        {!validRule &&
          (value !== "" || targets.length === 0 || operation === "round") && (
            <Banner tone="warning">
              <p>{ruleErrors.join(" ")}</p>
            </Banner>
          )}
        {guards.hasBreaches && currentPreview && (
          <Banner
            title={`${guards.totalBreached} variants breach your price safeguards`}
            tone="warning"
          >
            <p>
              Review the highlighted prices. You will need to confirm a
              safeguard bypass before applying.
            </p>
          </Banner>
        )}

        <section
          className={`${styles.card} ${styles.previewCard}`}
          aria-labelledby="preview-heading"
          aria-busy={loadingPreview}
        >
          <div className={styles.previewHeading}>
            <h2 id="preview-heading">
              <span className={styles.liveDot} aria-hidden="true" /> Live Price
              Preview
              {preview
                ? `: ${productCount} matching ${productCount === 1 ? "product" : "products"} (${variants.length} variants)`
                : ""}
            </h2>
            <span className={styles.currency}>{currencyCode}</span>
          </div>
          {!preview ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon} aria-hidden="true">
                ⌕
              </div>
              <h3>{loadingPreview ? "Loading products" : "No products found"}</h3>
              <p>
                {loadingPreview
                  ? "Loading your catalog and its current prices…"
                  : "Your catalog preview will appear here automatically."}
              </p>
            </div>
          ) : variants.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>No products match these conditions</h3>
              <p>
                Try another value, remove a condition, or switch to “any
                condition”.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.tableScroll}>
                <table className={styles.previewTable}>
                  <caption className={styles.srOnly}>
                    Current and proposed prices for matching product variants
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Image</th>
                      <th scope="col">Product &amp; variant</th>
                      <th scope="col">Current Price</th>
                      <th scope="col">Current Compare-at</th>
                      <th scope="col">New Price (Live)</th>
                      <th scope="col">New Compare-at (Live)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleVariants.map((variant, index) => {
                      const calculation = currentPreview
                        ? calculations[(page - 1) * PAGE_SIZE + index]
                        : undefined;
                      return (
                        <tr
                          key={variant.id}
                          className={
                            calculation?.guardBreached
                              ? styles.breachedRow
                              : undefined
                          }
                        >
                          <td className={styles.rowNumber}>
                            {(page - 1) * PAGE_SIZE + index + 1}
                          </td>
                          <td>
                            {variant.imageUrl ? (
                              <img
                                className={styles.productImage}
                                src={variant.imageUrl}
                                alt={variant.imageAlt || variant.productTitle}
                                loading="lazy"
                              />
                            ) : (
                              <div
                                className={styles.imagePlaceholder}
                                aria-label="No product image"
                              >
                                ◇
                              </div>
                            )}
                          </td>
                          <td className={styles.productCell}>
                            <strong>{variant.productTitle}</strong>
                            <span>
                              {variant.title === "Default Title"
                                ? "Standard"
                                : variant.title}
                              {variant.sku ? ` · ${variant.sku}` : ""}
                            </span>
                            {calculation?.guardBreached && (
                              <span className={styles.guardLabel}>
                                {calculation.guardWarningMessage}
                              </span>
                            )}
                          </td>
                          <td>{money(variant.price)}</td>
                          <td>{money(variant.compareAtPrice)}</td>
                          <td
                            className={
                              calculation &&
                              calculation.newPrice !== variant.price
                                ? styles.changedPrice
                                : undefined
                            }
                          >
                            {calculation ? money(calculation.newPrice) : "—"}
                          </td>
                          <td
                            className={
                              calculation &&
                              calculation.newCompareAtPrice !==
                                variant.compareAtPrice
                                ? styles.changedPrice
                                : undefined
                            }
                          >
                            {calculation
                              ? money(calculation.newCompareAtPrice)
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={styles.tableFooter}>
                <p aria-live="polite">
                  Showing {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, variants.length)} of{" "}
                  {variants.length} variants
                  {currentPreview && validRule
                    ? ` · ${changedCount} will change`
                    : ""}
                </p>
                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={page <= 1}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    {page} / {pages}
                  </span>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={page >= pages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
        {missingCompareAt && (
          <p className={styles.hint}>
            Empty compare-at prices stay empty for increases, decreases, and
            rounding. Use “Set to fixed price” to create them.
          </p>
        )}

        <details className={`${styles.card} ${styles.advanced}`}>
          <summary>
            Scheduling &amp; safeguards <span>Optional</span>
          </summary>
          <div className={styles.advancedGrid}>
            <div>
              <h3>Price safeguards</h3>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={enableGuards}
                  onChange={(event) => setEnableGuards(event.target.checked)}
                />{" "}
                Warn when selected prices go outside a range
              </label>
              {enableGuards && (
                <div className={styles.guardInputs}>
                  <label>
                    <span>Minimum ({currencyCode})</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={floor}
                      onChange={(event) => setFloor(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Maximum ({currencyCode})</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={ceiling}
                      placeholder="No maximum"
                      onChange={(event) => setCeiling(event.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
            <div>
              <h3>
                Schedule a sale <span className={styles.pill}>Pro</span>
              </h3>
              {!isPro ? (
                <p className={styles.hint}>
                  <Link to="/app/billing">Upgrade to Pro</Link> to schedule a future
                  adjustment and automatically restore prices.
                </p>
              ) : (
                <>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={schedule}
                      onChange={(event) => setSchedule(event.target.checked)}
                    />{" "}
                    Apply this adjustment at a future time
                  </label>
                  {schedule && (
                    <>
                      <div className={styles.guardInputs}>
                        <label>
                          <span>Start date &amp; time</span>
                          <input
                            type="datetime-local"
                            value={start}
                            onChange={(event) => setStart(event.target.value)}
                          />
                        </label>
                        <label>
                          <span>End date &amp; time (optional)</span>
                          <input
                            type="datetime-local"
                            value={end}
                            onChange={(event) => setEnd(event.target.value)}
                          />
                        </label>
                      </div>
                      <p className={styles.hint}>
                        Times use your device’s time zone. Matching products and
                        prices are evaluated again when the sale starts.
                      </p>
                      <label className={styles.checkLabel}>
                        <input
                          type="checkbox"
                          checked={autoRevert}
                          onChange={(event) =>
                            setAutoRevert(event.target.checked)
                          }
                        />{" "}
                        Automatically restore prices when the sale ends
                      </label>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </details>
        <p className={styles.bottomNote}>
          A snapshot of both price fields is saved before each adjustment so you
          can roll back later.
        </p>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={
          schedule ? "Confirm scheduled adjustment" : "Confirm price adjustment"
        }
        primaryAction={{
          content: schedule ? "Confirm & Schedule" : "Apply Changes Now",
          loading: applying,
          disabled: !canApply || (guards.hasBreaches && !guardBypassed),
          onAction: () => {
            if (canApply) {
              setConfirmOpen(false);
              onApply(submission());
            }
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setConfirmOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <p>
              <strong>{describeAdjustment(rule)}</strong> for {changedCount}{" "}
              variants across {productCount} matching products.
            </p>
            <p>
              Update:{" "}
              {targets
                .map((target) =>
                  target === "price" ? "Main Price" : "Compare-at Price",
                )
                .join(" and ")}
              .
            </p>
            <p>
              Match {matchMode} conditions:{" "}
              {describeConditions(filters).join("; ") || "All products"}.
            </p>
            {schedule && (
              <p>
                Starts {start.replace("T", " ")}
                {end ? ` · Ends ${end.replace("T", " ")}` : ""} (your device’s
                time zone).
              </p>
            )}
            {guards.hasBreaches ? (
              <Banner
                tone="warning"
                title={`${guards.totalBreached} variants breach safeguards`}
              >
                <Checkbox
                  checked={guardBypassed}
                  onChange={setGuardBypassed}
                  label="I reviewed the warnings and confirm that these prices may bypass my safeguards."
                />
              </Banner>
            ) : (
              <Banner tone="info">
                <p>
                  Original prices will be saved for rollback before updates are
                  applied.
                </p>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
