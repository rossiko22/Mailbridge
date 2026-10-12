import "express-session";
import { type User } from "../modules/users/users.types.js";

declare module "express-session" {
    interface SessionData {
        userId?: User["userId"];
        mailOAuth?: import('../integrations/mail/types.js').PendingAuth;
    }
}
