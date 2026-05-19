import session from "express-session";

const isProd = process.env.NODE_ENV === "production";

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;
  if (isProd) {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return "krkn-dashboard-dev-session-secret-change-me";
}

export function createSessionMiddleware() {
  return session({
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    name: "krkn.sid",
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  });
}

export async function loadSessionUser(req) {
  const sid = req.session?.userId;
  if (!sid) return null;
  const { findById, getUserGroupIds, toPublicUser } = await import(
    "../db/users.js"
  );
  const row = await findById(sid);
  if (!row || row.disabled) return null;
  const groupIds = await getUserGroupIds(row.id);
  return {
    ...toPublicUser(row),
    groupIds,
  };
}

export async function attachUserToSession(req, userRow) {
  const { getUserGroupIds, toPublicUser } = await import("../db/users.js");
  const groupIds = await getUserGroupIds(userRow.id);
  req.session.userId = userRow.id;
  req.session.user = {
    ...toPublicUser(userRow),
    groupIds,
  };
  return req.session.user;
}
