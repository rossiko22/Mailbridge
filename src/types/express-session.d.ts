import "express-session";
import { type User } from "../modules/users/users.types.js";

declare module "express-session" {
    interface SessionData {
        userId?: User["userId"];
        outlookOAuth?: import('../integrations/outlook/oauth.js').OAuthState;
    }
}
