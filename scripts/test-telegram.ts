/**
 * Reading Saudi job channels on Telegram.
 *
 *   npm run test:telegram
 *
 * Headlines, employers and cities are from real posts seen on 2026-10-21
 * (public job announcements); the page and article markup is a trimmed copy
 * of the real structure. Zero network.
 */
import { articleRecord, citiesOf, employerOf, headline, parseChannelPage } from "../src/lib/adapters/telegram";

let total = 0;
let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FAIL ${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
  }
}

/* ------------------------------ a channel page ------------------------------ */
const PAGE = `
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="cd4cd/37529">
  <a class="tgme_widget_message_photo_wrap" style="width:800px;background-image:url('https://cdn4.telesco.pe/file/abc.jpg')"></a>
  <div class="tgme_widget_message_text js-message_text" dir="auto">🚀 شركة المراعي تعلن فتح باب التوظيف (للثانوية فأعلى) رجال ونساء:<br/><br/>📍الخرج.<br/>📍الرياض.<br/><br/>🔗 انشر الخبر عبر (<a href="https://api.whatsapp.com/send?text=x">whatsapp</a>)<br/> ↩️ للتقديم (<a href="https://wdeftksa.com/sa/jobs/100850">link</a>)</div>
  <a class="tgme_widget_message_date" href="https://t.me/cd4cd/37529"><time datetime="2026-10-20T10:42:10+00:00" class="time">10:42</time></a>
</div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="cd4cd/37530">
  <div class="tgme_widget_message_text js-message_text" dir="auto">⭕️ | الهيئة السعودية للتخصصات الصحية تعلن فرصة للتدريب على رأس العمل ضمن برنامج تمهير:<br/>▪️جميع التخصصات التقنية.<br/><a href="https://t.me/cd4cd">@cd4cd</a></div>
  <a class="tgme_widget_message_date" href="https://t.me/cd4cd/37530"><time datetime="2026-10-20T14:16:15+00:00" class="time">14:16</time></a>
</div></div>
<a class="tme_messages_more js-messages_more" data-before="37529" href="/s/cd4cd?before=37529"></a>`;

const page = parseChannelPage(PAGE, "cd4cd");
check("both posts read", page.posts.map((p) => p.id), ["37529", "37530"]);
check("the older-posts link", page.before, "37529");
check("the post time", page.posts[0].at, "2026-10-20T10:42:10+00:00");
check("the picture", page.posts[0].photo, "https://cdn4.telesco.pe/file/abc.jpg");
check("links: the article kept, WhatsApp share and t.me dropped", page.posts[0].links, ["https://wdeftksa.com/sa/jobs/100850"]);
check("line breaks kept in the text", page.posts[0].text.includes("\n"), true);
check("no picture, no photo", page.posts[1].photo, null);

/* --------------------------------- headlines -------------------------------- */
check("headline: emoji and bar removed", headline("⭕️ | الهيئة السعودية للتخصصات الصحية تعلن فرصة للتدريب"), "الهيئة السعودية للتخصصات الصحية تعلن فرصة للتدريب");
check("headline: (🔴) removed", headline("(🔴) مطاعم كودو تعلن وظائف شاغرة بمختلف فروع المملكة:"), "مطاعم كودو تعلن وظائف شاغرة بمختلف فروع المملكة:");
check("headline: a label-only first line is skipped", headline("(توظيف مباشر - عاجل)\n\nفندق شيراتون مكة يعلن 17 وظيفة شاغرة"), "فندق شيراتون مكة يعلن 17 وظيفة شاغرة");
check("headline: (حكومي) removed", headline("(حكومي) فتح التوظيف لدى مكتب الإدارة الاستراتيجية للجنسين:"), "فتح التوظيف لدى مكتب الإدارة الاستراتيجية للجنسين:");
check("headline: urgency label removed", headline("عاااجل | البنك الأهلي السعودي يعلن برنامج (التقنية والبيانات)"), "البنك الأهلي السعودي يعلن برنامج (التقنية والبيانات)");
check("headline: 'عاجل' without a bar", headline("عاجل تدريب تعاوني ( شركة علم):"), "تدريب تعاوني ( شركة علم):");
check("headline: a label with a star", headline("توظيف حكومي 🌟 المركز الوطني لنظم الموارد الحكومية يعلن فرص توظيف"), "المركز الوطني لنظم الموارد الحكومية يعلن فرص توظيف");
check("employer: after an urgency label", employerOf("عاااجل | البنك الأهلي السعودي يعلن برنامج (التقنية والبيانات)"), "البنك الأهلي السعودي");
check("headline: a word starting like a label is kept", headline("جديدة الشركة تعلن وظائف"), "جديدة الشركة تعلن وظائف");

/* --------------------------------- employers -------------------------------- */
check("employer: لدى X في", employerOf("فتح التوظيف لدى شركة بنده في عدة مجالات."), "شركة بنده");
check("employer: X تعلن", employerOf("🚀 شركة المراعي تعلن فتح باب التوظيف (للثانوية فأعلى)"), "شركة المراعي");
check("employer: after the decoration", employerOf("⭕️ | مختبرات أبوت تعلن فرص وظيفية شاغرة"), "مختبرات أبوت");
check("employer: لدى X (", employerOf("(حكومي) فتح التوظيف لدى مكتب الإدارة الاستراتيجية (أحد برامج رؤية المملكة 2030)"), "مكتب الإدارة الاستراتيجية");
check("employer: English", employerOf("Elm is hiring cloud engineers in Riyadh"), "Elm");
check("employer: none named -> none invented", employerOf("وظائف شاغرة للجنسين"), null);

/* ---------------------------------- cities ---------------------------------- */
check("cities: a listed Riyadh is kept", citiesOf("📍الخرج.\n📍الرياض.\n📍جدة."), "Riyadh, Jeddah, Al Kharj, Saudi Arabia");
check("cities: other cities only", citiesOf("للعمل في جدة والدمام"), "Jeddah, Dammam, Saudi Arabia");
check("cities: 'several cities' names none -> Saudi Arabia, city unproven", citiesOf("في عدة مدن بالمملكة"), "Saudi Arabia");
check("cities: 'the city' is not Madinah", citiesOf("داخل المدينة الصناعية"), "Saudi Arabia");
check("cities: all regions of the Kingdom include Riyadh", citiesOf("برنامج تدريب منتهي بالتوظيف في جميع مناطق المملكة"), "Riyadh (all regions of the Kingdom), Saudi Arabia");

/* --------------------------------- articles --------------------------------- */
// jobzaty.com: a JobPosting record and a link to the employer's careers site.
const JOBZATY = `<html><head><link rel="canonical" href="https://www.jobzaty.com/job/panda-jobs-33207">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"شركة بنده تعلن 11 فرصة وظيفية وتدريبية","description":"<p>تعلن <b>شركة بنده</b> عن فرص في تقنية المعلومات وأمن المعلومات لحديثي التخرج في الرياض.</p>","validThrough":"2026-11-15T00:00:00+03:00","hiringOrganization":{"@type":"Organization","name":"شركة بنده للتجزئة"},"jobLocation":{"@type":"Place","address":{"addressLocality":"غير محدد"}}}</script>
</head><body><a href="https://x.com/JobZatyCom">X</a><a href="https://careers.panda.com.sa/">التقديم</a></body></html>`;
const a = articleRecord(JOBZATY);
check("article: title", a?.title, "شركة بنده تعلن 11 فرصة وظيفية وتدريبية");
check("article: employer", a?.company, "شركة بنده للتجزئة");
check("article: text read from the record", a?.text.includes("أمن المعلومات"), true);
check("article: closing date", a?.closesAt?.slice(0, 10), "2026-11-14");
check("article: 'not stated' is no location", a?.location, undefined);
check("article: the official apply link, not social media", a?.applyUrl, "https://careers.panda.com.sa/");

// wdeftksa.com: the record sits inside an @graph, without a JobPosting type.
const WDEFT = `<html><head><link rel="canonical" href="https://www.wdeftksa.com/sa/jobs/100851">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","@id":"x"},{"title":"هيئة التخصصات الصحية توفر فرصة للتدريب على رأس العمل","description":"<p>برنامج تمهير في جميع التخصصات التقنية والإدارية.</p>"}]}</script>
</head><body><a href="https://wa.me/966500000000">wa</a><a href="https://jobs.scfhs.org.sa/tamheer">apply</a></body></html>`;
const w = articleRecord(WDEFT);
check("article in an @graph: title", w?.title, "هيئة التخصصات الصحية توفر فرصة للتدريب على رأس العمل");
check("article in an @graph: text", w?.text.includes("تمهير"), true);
check("article in an @graph: apply link past WhatsApp", w?.applyUrl, "https://jobs.scfhs.org.sa/tamheer");
check("a page without a record -> none", articleRecord("<html><body>hello</body></html>"), null);

console.log(`telegram: ${total - failures}/${total} correct`);
if (failures > 0) process.exit(1);
