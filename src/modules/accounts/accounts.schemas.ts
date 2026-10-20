import { z } from 'zod';
import { uuid } from '../../http/validate.js';

// Request input of /accounts, as in contracts/openapi.yaml.

export const accountIdParams = z.object({ id: uuid('Invalid account ID.') });

// The provider adds parameters of its own (scope, session_state, iss, ...), so this object is not strict.
// Anything that does not fit is handled like a missing value: the flow ends with a clear outcome, never a JSON error.
export const callbackQuery = z.object({
    code: z.string().min(1).max(4096).optional().catch(undefined),
    state: z.string().min(1).max(200).optional().catch(undefined),
});
