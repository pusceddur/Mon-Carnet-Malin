// STUB helper shared by route stubs (foundations). Delete once no router uses it.
import { Router, type RequestHandler } from 'express';
import { ERROR_MESSAGES_FR, errorBody } from '../errors';

export const notImplementedHandler: RequestHandler = (_req, res) => {
  res.status(501).json(errorBody('not_implemented', ERROR_MESSAGES_FR.not_implemented));
};

/** Router answering 501 `not_implemented` to every request. */
export function notImplementedRouter(): Router {
  const router = Router();
  router.use(notImplementedHandler);
  return router;
}
