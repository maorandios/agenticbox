import type { EligibilityThreadInput } from "../eligibility";
import type { FeedCandidate, FeedExtractionResult } from "../schemas";
import { emptyIntelligenceState } from "../schemas";

export type FeedFixture = {
  id: string;
  description: string;
  /** Expected prefilter classification when applicable */
  expectPrefilter?: {
    classification: string;
    eligibleForExtraction: boolean;
  };
  thread: EligibilityThreadInput;
  /** Synthetic AI output for post-validation tests (optional). */
  modelResult?: FeedExtractionResult;
  /** Expected accepted count after validation gate + candidate rules. */
  expectAccepted?: number;
  expectRejectReasons?: string[];
};

function baseItem(
  over: Partial<FeedCandidate> & Pick<FeedCandidate, "type" | "headline" | "evidenceText">,
): FeedCandidate {
  return {
    context: null,
    actorName: null,
    actorEmail: null,
    sourceMessageId: "msg-1",
    actionOwner: null,
    responsibilityScope: null,
    requestDirection: null,
    relationToMailbox: null,
    requestedAction: null,
    actionVerb: null,
    actionObject: null,
    actionPurpose: null,
    requester: null,
    assignee: null,
    beneficiary: null,
    responseRecipient: null,
    requestModality: null,
    requestSpeechAct: null,
    attributionConfidence: null,
    semanticPrecisionConfidence: null,
    requestEvidence: null,
    supportingEvidence: [],
    businessObject: null,
    previousValue: null,
    currentValue: null,
    occurredAt: "2026-08-10T10:00:00.000Z",
    requestedAt: null,
    dueAt: null,
    dueEvidenceText: null,
    dueSourceMessageId: null,
    confidence: 0.92,
    businessRelevanceConfidence: 0.9,
    topicKey: "t1",
    replacesSourceMessageId: null,
    ...over,
  } as FeedCandidate;
}

function result(
  over: Partial<FeedExtractionResult> & { items: FeedCandidate[] },
): FeedExtractionResult {
  return {
    threadClassification: "business",
    skipReason: null,
    nextState: emptyIntelligenceState(),
    ...over,
  };
}

export const FEED_QUALITY_FIXTURES: FeedFixture[] = [
  {
    id: "1-supabase-release",
    description: "Supabase release notes / public beta → prefilter skip",
    expectPrefilter: {
      classification: "bulk_marketing",
      eligibleForExtraction: false,
    },
    thread: {
      subject: "Supabase product updates — public beta",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "Supabase product updates — public beta",
          fromEmail: "newsletter@example.com",
          fromName: "Product News",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "What's new this week. Unified Logs is now in public beta. Release notes: https://example.com/x?utm_source=newsletter&utm_campaign=aug View in browser. Unsubscribe anytime.",
        },
      ],
    },
  },
  {
    id: "2-webinar-tickets",
    description: "Webinar / tickets → prefilter skip",
    expectPrefilter: {
      classification: "bulk_marketing",
      eligibleForExtraction: false,
    },
    thread: {
      subject: "Get tickets to our webinar",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "Get tickets to our webinar",
          fromEmail: "marketing@events.example",
          fromName: "Events",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "Join our webinar next week. Get tickets now. Manage email preferences or unsubscribe.",
        },
      ],
    },
  },
  {
    id: "3-cta-try-now",
    description: "CTA try now → prefilter skip",
    expectPrefilter: {
      classification: "bulk_marketing",
      eligibleForExtraction: false,
    },
    thread: {
      subject: "Try our new dashboard",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "Try our new dashboard",
          fromEmail: "updates@saas.example",
          fromName: "SaaS Updates",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "נסה עכשיו את הפיצ'ר החדש. Learn more and unsubscribe below. utm_source=email&utm_medium=newsletter",
        },
      ],
    },
  },
  {
    id: "4-approve-qty",
    description: "נא לאשר 40 יחידות → Action",
    expectPrefilter: {
      classification: "important_transactional",
      eligibleForExtraction: true,
    },
    expectAccepted: 1,
    thread: {
      subject: "הזמנה — אישור כמות",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "הזמנה — אישור כמות",
          fromEmail: "client@customer.com",
          fromName: "דוד",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "שלום, נא לאשר 40 יחידות ולציין אספקה לשבוע הבא. תודה.",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "action",
          headline: "לאשר 40 יחידות ולציין מועד אספקה",
          evidenceText: "נא לאשר 40 יחידות ולציין אספקה לשבוע הבא",
          actorName: "דוד",
          actorEmail: "client@customer.com",
          actionOwner: "account_owner",
          dueAt: "2026-08-18T00:00:00.000Z",
          dueEvidenceText: "לציין אספקה לשבוע הבא",
          dueSourceMessageId: "msg-1",
        }),
      ],
    }),
  },
  {
    id: "5-qty-change",
    description: "כמות השתנתה → Change",
    expectPrefilter: { classification: "business_conversation", eligibleForExtraction: true },
    expectAccepted: 1,
    thread: {
      subject: "עדכון הזמנה",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "עדכון הזמנה",
          fromEmail: "client@customer.com",
          fromName: "דוד",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "היי, הכמות השתנתה מ-20 ל-40 יחידות לפי הסיכום.",
        },
        {
          subject: "Re: עדכון הזמנה",
          fromEmail: "owner@biz.co.il",
          fromName: "אני",
          toEmails: ["client@customer.com"],
          direction: "outbound",
          body: "קיבלתי, נעדכן.",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "change",
          headline: "הכמות עודכנה מ-20 ל-40 יחידות",
          evidenceText: "הכמות השתנתה מ-20 ל-40 יחידות",
          actorEmail: "client@customer.com",
          businessObject: "כמות הזמנה",
          previousValue: "20",
          currentValue: "40",
        }),
      ],
    }),
  },
  {
    id: "6-decision-roof",
    description: "מאשרים סופית מודל גג → Decision",
    expectPrefilter: { classification: "important_transactional", eligibleForExtraction: true },
    expectAccepted: 1,
    thread: {
      subject: "אישור מודל גג",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "אישור מודל גג",
          fromEmail: "client@customer.com",
          fromName: "דוד",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "מאשרים סופית את מודל הגג כפי שנשלח ביום ראשון.",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "decision",
          headline: "אושר סופית מודל הגג",
          evidenceText: "מאשרים סופית את מודל הגג",
          actorEmail: "client@customer.com",
          businessObject: "מודל גג",
        }),
      ],
    }),
  },
  {
    id: "7-external-action",
    description: "דוד יעדכן — Action חיצוני (לא של המשתמש)",
    expectAccepted: 1,
    thread: {
      subject: "המשך הזמנה",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "המשך הזמנה",
          fromEmail: "pm@partner.com",
          fromName: "מיכל",
          toEmails: ["owner@biz.co.il", "david@other.com"],
          direction: "inbound",
          body: "דוד יעדכן את ההזמנה וישלח אישור.",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "action",
          headline: "לעדכן את ההזמנה",
          evidenceText: "דוד יעדכן את ההזמנה וישלח אישור",
          actionOwner: "external_person",
          actorEmail: "pm@partner.com",
          requester: {
            name: "מיכל",
            email: "pm@partner.com",
            evidenceText: "דוד יעדכן את ההזמנה וישלח אישור",
          },
          assignee: {
            name: "דוד",
            email: "david@other.com",
            evidenceText: "דוד יעדכן את ההזמנה וישלח אישור",
          },
        }),
      ],
    }),
  },
  {
    id: "8-owner-commitment",
    description: "התחייבות יוצאת מבעל התיבה → Action",
    expectAccepted: 1,
    thread: {
      subject: "תוכנית עבודה",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "תוכנית עבודה",
          fromEmail: "owner@biz.co.il",
          fromName: "אני",
          toEmails: ["client@customer.com"],
          direction: "outbound",
          body: "אנחנו נשלח את התוכנית מחר בבוקר.",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "action",
          headline: "לשלוח את התוכנית מחר",
          evidenceText: "אנחנו נשלח את התוכנית מחר בבוקר",
          actionOwner: "account_owner",
          actorEmail: "owner@biz.co.il",
          dueAt: "2026-08-11T08:00:00.000Z",
          dueEvidenceText: "מחר",
          dueSourceMessageId: "msg-1",
          requestModality: "commitment",
        }),
      ],
    }),
  },
  {
    id: "9-invoice-noreply",
    description: "חשבונית מ-no-reply → eligible + Action עם dueAt",
    expectPrefilter: {
      classification: "important_transactional",
      eligibleForExtraction: true,
    },
    expectAccepted: 1,
    thread: {
      subject: "Invoice 1844 due",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "Invoice 1844 due",
          fromEmail: "no-reply@billing.example",
          fromName: "Billing",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "Your invoice 1844 is ready. Payment due by 18 August 2026. Please pay the outstanding balance.",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "action",
          headline: "לשלם חשבונית 1844 עד 18 באוגוסט",
          evidenceText: "Payment due by 18 August 2026",
          actionOwner: "account_owner",
          actorEmail: "no-reply@billing.example",
          dueAt: "2026-08-18T00:00:00.000Z",
          dueEvidenceText: "Payment due by 18 August 2026",
          dueSourceMessageId: "msg-1",
          businessObject: "invoice 1844",
        }),
      ],
    }),
  },
  {
    id: "10-new-lead",
    description: "Lead מטופס אתר → eligible",
    expectPrefilter: {
      classification: "important_transactional",
      eligibleForExtraction: true,
    },
    thread: {
      subject: "ליד חדש מטופס יצירת קשר",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "ליד חדש מטופס יצירת קשר",
          fromEmail: "forms@website.example",
          fromName: "Site Forms",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "התקבלה פנייה חדשה מאתר: יוסי מעוניין בהצעת מחיר לגג פח.",
        },
      ],
    },
  },
  {
    id: "11-signature-only",
    description: "חתימה עם טלפון — אין פריט מהחתימה",
    expectAccepted: 0,
    expectRejectReasons: ["evidence_from_removed_section", "evidence_not_found"],
    thread: {
      subject: "תודה",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "תודה",
          fromEmail: "client@customer.com",
          fromName: "דוד",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "תודה.\n--\nדוד לוי\n050-1234567\nwww.example.com",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "action",
          headline: "להתקשר לדוד",
          evidenceText: "050-1234567",
          actionOwner: "account_owner",
        }),
      ],
    }),
  },
  {
    id: "12-quoted-old-task",
    description: "quoted text עם משימה ישנה — לא משימה חדשה",
    expectAccepted: 0,
    expectRejectReasons: ["evidence_from_removed_section", "evidence_not_found"],
    thread: {
      subject: "Re: הזמנה",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "Re: הזמנה",
          fromEmail: "client@customer.com",
          fromName: "דוד",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "קיבלתי, תודה.\n\nOn Mon, Aug 1, client wrote:\nנא לשלוח את המפרט המעודכן עד יום רביעי",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "action",
          headline: "לשלוח את המפרט המעודכן",
          evidenceText: "נא לשלוח את המפרט המעודכן עד יום רביעי",
          actionOwner: "account_owner",
        }),
      ],
    }),
  },
  {
    id: "13-action-with-due",
    description: "Action + deadline → כרטיס אחד עם dueAt, בלי due נפרד",
    expectAccepted: 1,
    thread: {
      subject: "הצעת מחיר",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "הצעת מחיר",
          fromEmail: "client@customer.com",
          fromName: "דוד",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "נא להשיב להצעת המחיר עד יום חמישי 14 באוגוסט.",
        },
      ],
    },
    modelResult: result({
      items: [
        baseItem({
          type: "action",
          headline: "להשיב להצעת המחיר עד יום חמישי",
          evidenceText: "נא להשיב להצעת המחיר עד יום חמישי 14 באוגוסט",
          actionOwner: "account_owner",
          actorEmail: "client@customer.com",
          dueAt: "2026-08-14T00:00:00.000Z",
          dueEvidenceText: "עד יום חמישי 14 באוגוסט",
          dueSourceMessageId: "msg-1",
        }),
      ],
    }),
  },
  {
    id: "14-product-beta-newsletter",
    description: "מוצר ב-beta בניוזלטר — לא Change",
    expectPrefilter: {
      classification: "bulk_marketing",
      eligibleForExtraction: false,
    },
    thread: {
      subject: "Product changelog",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "Product changelog",
          fromEmail: "newsletter@vendor.example",
          fromName: "Vendor",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: "Our product entered public beta this week. Unsubscribe | view in browser | utm_campaign=beta",
        },
      ],
    },
  },
  {
    id: "15-empty-image",
    description: "הודעה ריקה → insufficient_content",
    expectPrefilter: {
      classification: "insufficient_content",
      eligibleForExtraction: false,
    },
    thread: {
      subject: "תמונה",
      accountEmail: "owner@biz.co.il",
      messages: [
        {
          subject: "תמונה",
          fromEmail: "client@customer.com",
          fromName: "דוד",
          toEmails: ["owner@biz.co.il"],
          direction: "inbound",
          body: " ",
        },
      ],
    },
  },
];
