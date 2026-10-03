// Cloudflare Pages Functions entry. Every /api/* request lands here and is handled by the Hono app.
import { handle } from 'hono/cloudflare-pages';
import { app } from '../../server/app';

export const onRequest = handle(app);
