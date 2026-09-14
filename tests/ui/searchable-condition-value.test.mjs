import test, { after } from "node:test";
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
});
const { createRoot } = await import("react-dom/client");
const { SearchableConditionValue } =
  await import("../../app/components/searchable-condition-value.tsx");
const { AdjustmentEditor } =
  await import("../../app/components/adjustment-editor.tsx");
const { AppProvider } = await import("@shopify/polaris");

after(() => dom.window.close());

async function mount(t, element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  await act(() => root.render(element));
  return container;
}
async function type(input, value) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function key(input, value) {
  await act(() =>
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

for (const [field, fieldLabel] of [
  ["tag", "Tag"],
  ["vendor", "Vendor"],
  ["productType", "Product type"],
  ["collection", "Collection"],
  ["status", "Product status"],
]) {
  test(
    `${fieldLabel}: typing, selection, and other controls remain responsive`,
    { timeout: 5000 },
    async (t) => {
      let selected;
      function Harness() {
        const [condition, setCondition] = useState({
          field,
          operator: "equals",
          value: "",
        });
        const [clicks, setClicks] = useState(0);
        const [otherValue, setOtherValue] = useState("");
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(SearchableConditionValue, {
            condition,
            fieldLabel,
            index: 0,
            options: [
              { label: "Summer", value: "summer-id" },
              { label: "Winter", value: "winter-id" },
            ],
            onChange(value, label) {
              selected = value;
              setCondition({ ...condition, value, label });
            },
          }),
          React.createElement(
            "button",
            { onClick: () => setClicks(clicks + 1) },
            `Other button ${clicks}`,
          ),
          React.createElement("input", {
            "aria-label": "Other input",
            value: otherValue,
            onChange: (event) => setOtherValue(event.target.value),
          }),
        );
      }
      const container = await mount(t, React.createElement(Harness));
      const input = container.querySelector('[role="combobox"]');
      await act(() => input.focus());
      assert.equal(container.querySelectorAll('[role="option"]').length, 2);
      for (const value of ["S", "Su", "Sum"]) {
        await type(input, value);
        assert.equal(input.value, value);
      }
      assert.equal(selected, "");
      assert.equal(
        container.querySelector('[role="option"]').textContent,
        "Summer",
      );
      await act(() => container.querySelector('[role="option"]').click());
      assert.equal(input.value, "Summer");
      assert.equal(selected, "summer-id");
      assert.equal(input.getAttribute("aria-expanded"), "false");
      // Reopen the suggestions, then move to unrelated controls.
      await act(() => input.click());
      const other = [...container.querySelectorAll("button")].find((button) =>
        button.textContent.startsWith("Other button"),
      );
      await act(() => {
        other.focus();
        other.click();
      });
      assert.equal(other.textContent, "Other button 1");
      assert.equal(input.getAttribute("aria-expanded"), "false");
      const otherInput = container.querySelector('[aria-label="Other input"]');
      await type(otherInput, "Still works");
      assert.equal(otherInput.value, "Still works");
    },
  );
}

test("Keyboard navigation, clearing, Escape, Tab, and empty results", async (t) => {
  let selected;
  const container = await mount(
    t,
    React.createElement(SearchableConditionValue, {
      condition: { field: "tag", operator: "equals", value: "" },
      fieldLabel: "Tag",
      index: 0,
      options: [
        { label: "Summer", value: "Summer" },
        { label: "Winter", value: "Winter" },
      ],
      onChange: (value) => {
        selected = value;
      },
    }),
  );
  const input = container.querySelector("input");
  await act(() => input.focus());
  await key(input, "ArrowDown");
  await key(input, "ArrowDown");
  await key(input, "Enter");
  assert.equal(input.value, "Winter");
  assert.equal(selected, "Winter");
  await act(() =>
    container.querySelector('[aria-label="Clear tag value"]').click(),
  );
  assert.equal(input.value, "");
  assert.equal(selected, "");
  await type(input, "no-match");
  assert.equal(
    container.querySelector('[role="status"]').textContent,
    "No matching tag values",
  );
  await key(input, "ArrowDown");
  assert.equal(input.getAttribute("aria-activedescendant"), null);
  await key(input, "Escape");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  await act(() => input.click());
  await key(input, "Tab");
  assert.equal(input.getAttribute("aria-expanded"), "false");
});

test(
  "The complete adjustment page stays interactive after typing a tag",
  { timeout: 5000 },
  async (t) => {
    let filters;
    const options = {
      tag: [{ label: "Summer", value: "Summer" }],
      vendor: [],
      productType: [],
      collection: [],
      status: [],
    };
    const container = await mount(
      t,
      React.createElement(
        AppProvider,
        { i18n: {} },
        React.createElement(AdjustmentEditor, {
          options,
          currencyCode: "USD",
          isPro: false,
          loadingPreview: false,
          applying: false,
          onPreview: (value) => {
            filters = value;
          },
          onApply() {},
        }),
      ),
    );
    const button = (text) =>
      [...container.querySelectorAll("button")].find((item) =>
        item.textContent.includes(text),
      );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    assert.deepEqual(filters.conditions, []);
    await act(() => button("Add a filter").click());
    const input = container.querySelector('[role="combobox"]');
    await act(() => input.focus());
    await type(input, "Su");
    assert.equal(input.value, "Su");
    await act(() => container.querySelector('[role="option"]').click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    assert.equal(filters.conditions[0].value, "Summer");
    await act(() => button("Add another filter").click());
    assert.equal(container.querySelectorAll('[role="combobox"]').length, 2);
    const amount = container.querySelector('input[type="number"]');
    await type(amount, "15");
    assert.equal(amount.value, "15");
  },
);
