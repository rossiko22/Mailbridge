import type { SafeUser } from '../modules/users/users.types.js';

declare global {
    namespace Express {
        interface Request {
            currentUser?: SafeUser;
        }
    }
}
