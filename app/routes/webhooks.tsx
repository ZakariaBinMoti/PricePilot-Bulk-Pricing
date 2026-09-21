import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } =
    await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      {
        // Shopify may omit the Admin context and session after uninstall.
        await prisma.auditLog.deleteMany({ where: { shop } });
        // Delete snapshots through cascade (jobs → snapshots)
        await prisma.priceJob.deleteMany({ where: { shop } });
        await prisma.subscription.deleteMany({ where: { shop } });
        await prisma.session.deleteMany({ where: { shop } });
      }
      break;
    case "APP_SCOPES_UPDATE":
      // Handle scope changes if needed
      console.log(`Scopes updated for shop: ${shop}`);
      break;
    case "CUSTOMERS_DATA_REQUEST":
      // Price Adjuster does not store customer personal data.
      // Respond with 200 OK to acknowledge the request.
      break;
    case "CUSTOMERS_REDACT":
      // Price Adjuster does not store customer personal data.
      // Respond with 200 OK to acknowledge the request.
      break;
    case "SHOP_REDACT":
      // Shop data deletion request — purge all data for this shop
      await prisma.auditLog.deleteMany({ where: { shop } });
      await prisma.priceJob.deleteMany({ where: { shop } });
      await prisma.subscription.deleteMany({ where: { shop } });
      await prisma.session.deleteMany({ where: { shop } });
      break;
    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  throw new Response();
};
