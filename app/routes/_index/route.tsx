import { redirect, type LoaderFunctionArgs } from "react-router";
import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function AppIndex() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Price Adjuster</h1>
        <p className={styles.text}>
          Bulk price management for Shopify. Adjust thousands of product prices
          in one click with automatic Compare-at price sync, smart rounding,
          and instant rollback.
        </p>
      </div>
    </div>
  );
}
