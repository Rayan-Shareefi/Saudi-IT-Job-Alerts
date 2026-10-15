/**
 * Send the instant email for new time-sensitive jobs and co-op watch hits.
 *
 *   npm run alerts
 *
 * Called by the laptop worker every cycle and by GitHub after each fast pass,
 * so alerts still go out when the laptop is off. Each job is alerted once
 * (alerted_at) and the daily cap lives in the shared budget, so two callers
 * never double-send.
 */
import "dotenv/config";
import { sendTimeSensitiveAlerts } from "../src/lib/alerts";

sendTimeSensitiveAlerts()
  .then((n) => console.log(n ? `alerted ${n} item(s)` : "nothing time-sensitive to alert"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
