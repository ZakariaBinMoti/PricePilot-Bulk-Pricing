import type { Config } from "@react-router/dev/config";

const appUrl = process.env.SHOPIFY_APP_URL || process.env.HOST;
const appHost = appUrl
  ? new URL(appUrl.includes("://") ? appUrl : `http://${appUrl}`).host
  : null;

// Shopify sends embedded-app action requests through its Admin origin. React
// Router's single-fetch CSRF check otherwise rejects those legitimate POSTs
// before the route action can authenticate the merchant request.
export default {
  allowedActionOrigins: [
    ...(appHost ? [appHost] : []),
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "admin.shopify.com",
    "admin.shop.dev",
    "admin.myshopify.io",
    "*.myshopify.com",
    "*.shopify.com",
    "*.trycloudflare.com",
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.spin.dev",
  ],
} satisfies Config;
