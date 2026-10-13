import "express-session";
import { type User } from "../modules/users/users.types.js";

declare module "express-session" {
    interface SessionData {
        userId?: User["userId"];
        // When the person signed in; a session ends a fixed time after this however active it is.
        signedInAt?: number;
        mailOAuth?: import('../integrations/mail/types.js').PendingAuth;
        // Why the last mailbox connection failed. Shown once, then cleared.
        connectNotice?: string;
    }
}
