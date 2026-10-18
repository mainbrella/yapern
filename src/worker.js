import { handleMessagesRequest } from "./messages-api.js";

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/api/messages") {
      return handleMessagesRequest(request);
    }
    return env.ASSETS.fetch(request);
  },
};
