import { eveChannel } from "eve/channels/eve";
import { httpBasic, localDev } from "eve/channels/auth";

export default eveChannel({
  auth: [
    localDev(),
    httpBasic({
      username: process.env.ROUTE_AUTH_BASIC_USER ?? "",
      password: process.env.ROUTE_AUTH_BASIC_PASSWORD ?? "",
    }),
  ],
});