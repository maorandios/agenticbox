import { messages, participants } from "@/mocks/data";
import type { Message, ThreadAskKind, ThreadAskSource, ThreadAskTurn } from "@/types/domain";

export const THREAD_ASK_SUGGESTIONS = [
  "מה הוחלט בסוף?",
  "מה השתנה לאורך השרשור?",
  "מה עדיין דורש טיפול?",
] as const;

const NOT_FOUND = "לא מצאתי תשובה ברורה בשרשור.";
const FILE_NOT_ANALYZED =
  "ייתכן שהמידע נמצא בקובץ מצורף, אך תוכן הקבצים אינו מנותח כרגע.";

function messagePlainText(message: Message) {
  if (!message.content?.length) return message.body;
  return message.content
    .map((block) => {
      if (block.type === "paragraph" || block.type === "quoted-text") return block.text;
      if (block.type === "list") return block.items.join(" ");
      if (block.type === "inline-image") return block.fileName;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function buildSource(messageId: string, excerpt?: string): ThreadAskSource | null {
  const message = messages.find((m) => m.id === messageId);
  if (!message) return null;
  const sender = participants.find((p) => p.id === message.fromId);
  const text = messagePlainText(message).replace(/\s+/g, " ").trim();
  return {
    messageId,
    senderName: sender?.name ?? "לא ידוע",
    senderEmail: sender?.email,
    sentAt: message.sentAt,
    excerpt: excerpt ?? `${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`,
  };
}

function sources(ids: { id: string; excerpt?: string }[]): ThreadAskSource[] {
  return ids
    .map(({ id, excerpt }) => buildSource(id, excerpt))
    .filter((s): s is ThreadAskSource => Boolean(s));
}

function normalize(q: string) {
  return q.trim().toLowerCase().replace(/[?!.,״"'׳]/g, "");
}

function includesAny(q: string, needles: string[]) {
  return needles.some((n) => q.includes(n));
}

type MockReply = {
  kind: ThreadAskKind;
  answer: string;
  sourceMessageIds?: { id: string; excerpt?: string }[];
  clarificationOptions?: string[];
};

function resolveCityHub(q: string, previous: ThreadAskTurn[]): MockReply | null {
  const last = previous[previous.length - 1];

  if (last?.kind === "clarification") {
    if (includesAny(q, ["כמות", "65", "יחידות"])) {
      return {
        kind: "answer",
        answer:
          "הכמות שסוכמה בשרשור היא 65 יחידות, לאחר עדכון מ־40. מאור עדיין צריך לאשר את ההגדלה.",
        sourceMessageIds: [
          {
            id: "msg-city-1",
            excerpt:
              "הכמות עודכנה מ־40 ל־65 יחידות, ולכן נדרש תיאום מחדש של לוח הזמנים.",
          },
          {
            id: "msg-city-5",
            excerpt: "נוסף מועד יעד: 18 באוגוסט.\nההתקנה תתבצע בשני שלבים.",
          },
        ],
      };
    }
    if (includesAny(q, ["אספקה", "מועד", "תאריך"])) {
      return {
        kind: "answer",
        answer:
          "מועד היעד שצוין הוא 18 באוגוסט. ממתינים ליוסי לאישור מועד האספקה המעודכן.",
        sourceMessageIds: [
          {
            id: "msg-city-5",
            excerpt: "נוסף מועד יעד: 18 באוגוסט.\nההתקנה תתבצע בשני שלבים.",
          },
        ],
      };
    }
    if (includesAny(q, ["כניסה", "אתר", "גישה"])) {
      return {
        kind: "answer",
        answer:
          "בשרשור CityHub לא מופיע אישור כניסה נפרד לאתר — הדיון מתמקד בכמות, במועד ובהתקנה בשני שלבים.",
        sourceMessageIds: [
          {
            id: "msg-city-5",
            excerpt: "ההתקנה תתבצע בשני שלבים.",
          },
        ],
      };
    }
  }

  if (includesAny(q, ["מה הוחלט", "הוחלט בסוף", "החלטות"])) {
    return {
      kind: "answer",
      answer:
        "בסוף השרשור סוכמו: הגדלת הכמות ל־65 יחידות, מועד יעד ל־18 באוגוסט, והתקנה בשני שלבים. עדיין נדרש אישור שלך לכמות ומועד אספקה מעודכן.",
      sourceMessageIds: [
        {
          id: "msg-city-5",
          excerpt: "נוסף מועד יעד: 18 באוגוסט. ההתקנה תתבצע בשני שלבים.",
        },
        {
          id: "msg-city-1",
          excerpt: "הכמות עודכנה מ־40 ל־65 יחידות",
        },
      ],
    };
  }

  if (includesAny(q, ["מה השתנה", "לאורך השיחה", "לאורך השרשור", "שינויים"])) {
    return {
      kind: "answer",
      answer:
        "לאורך השיחה עודכנה הכמות מ־40 ל־65, צורפו תוכנית אתר ומסמכי היקף, נוסף מועד יעד ל־18 באוגוסט, והוגדר שההתקנה תתבצע בשני שלבים.",
      sourceMessageIds: [
        {
          id: "msg-city-1",
          excerpt:
            "הכמות עודכנה מ־40 ל־65 יחידות, ולכן נדרש תיאום מחדש של לוח הזמנים.",
        },
        {
          id: "msg-city-3",
          excerpt: "מצורפים תוכנית האתר, מסמך היקף העבודה וחבילת תמונות מהאתר.",
        },
        {
          id: "msg-city-5",
          excerpt: "נוסף מועד יעד: 18 באוגוסט. ההתקנה תתבצע בשני שלבים.",
        },
      ],
    };
  }

  if (includesAny(q, ["מי צריך", "לבצע מה", "משימות", "אחריות", "דורש טיפול", "עדיין פתוח"])) {
    return {
      kind: "answer",
      answer:
        "מאור צריך לעדכן לוח זמנים חדש ולאשר את הגדלת הכמות; נדרש גם לציין מועד אספקה מעודכן לצורך הזמנת הרכש. יוסי ממתין לאישור המועד.",
      sourceMessageIds: [
        {
          id: "msg-city-4",
          excerpt: "קיבלתי את הקובץ. אעבור עם צוות השטח ואחזור עם אישור עקרוני.",
        },
        {
          id: "msg-city-5",
          excerpt: "נדרש אישור שלך למועד + איש קשר באתר.",
        },
      ],
    };
  }

  if (includesAny(q, ["על מי ממתינים", "ממתינים", "מחכה", "מחכים"])) {
    return {
      kind: "answer",
      answer:
        "ממתינים ליוסי לאישור מועד האספקה, ולמאור לאישור הכמות המעודכנת ל־65 יחידות.",
      sourceMessageIds: [
        {
          id: "msg-city-5",
          excerpt: "נוסף מועד יעד: 18 באוגוסט. ההתקנה תתבצע בשני שלבים.",
        },
      ],
    };
  }

  if (includesAny(q, ["סכם", "השתלשלות", "סיכום", "timeline", "תקציר"])) {
    return {
      kind: "answer",
      answer:
        "עמית עדכן שהכמות עלתה ל־65; מאור אישר עקרונית לבדוק זמינות; צורפו תוכניות וקבצי אתר; לאחר מכן נוסף מועד יעד ל־18 באוגוסט והוגדרה התקנה בשני שלבים — וכעת נדרשים אישורי כמות ומועד.",
      sourceMessageIds: [
        {
          id: "msg-city-1",
          excerpt: "הכמות עודכנה מ־40 ל־65 יחידות",
        },
        {
          id: "msg-city-2",
          excerpt: "נקבל את הכמות החדשה ונבדוק זמינות צוות",
        },
        {
          id: "msg-city-5",
          excerpt: "נוסף מועד יעד: 18 באוגוסט. ההתקנה תתבצע בשני שלבים.",
        },
      ],
    };
  }

  if (includesAny(q, ["כמות", "65", "יחידות"]) && !includesAny(q, ["מי אישר"])) {
    return {
      kind: "answer",
      answer:
        "הכמות האחרונה שסוכמה בשרשור היא 65 יחידות, לאחר עדכון מ־40. מועד היעד שצוין הוא 18 באוגוסט.",
      sourceMessageIds: [
        {
          id: "msg-city-1",
          excerpt:
            "הכמות עודכנה מ־40 ל־65 יחידות, ולכן נדרש תיאום מחדש של לוח הזמנים.",
        },
        {
          id: "msg-city-5",
          excerpt: "נוסף מועד יעד: 18 באוגוסט. ההתקנה תתבצע בשני שלבים.",
        },
      ],
    };
  }

  if (
    includesAny(q, ["מי אישר", "מי ביקש", "מי עדכן"]) ||
    q === "מי" ||
    q.startsWith("מי ")
  ) {
    return {
      kind: "clarification",
      answer: "לאיזה פרט התכוונת?",
      clarificationOptions: ["אישור הכמות ל־65", "מועד האספקה", "כניסה לאתר"],
    };
  }

  return null;
}

function resolveGeneric(q: string): MockReply {
  if (
    includesAny(q, [
      "pdf",
      "xlsx",
      "docx",
      "קובץ",
      "קבצים",
      "מצורף",
      "מצורפים",
      "תוכנית האתר",
      "updated-plan",
      "quote-1048",
    ])
  ) {
    return { kind: "file_not_analyzed", answer: FILE_NOT_ANALYZED };
  }

  if (includesAny(q, ["ביטוח", "מחסן", "חיפה", "שכר", "משכורת"])) {
    return { kind: "not_found", answer: "לא מצאתי תשובה ברורה בשרשור." };
  }

  return { kind: "not_found", answer: "לא מצאתי תשובה ברורה בשרשור." };
}

/**
 * Mock thread Q&A — answers only from message bodies.
 * Never drafts mail, creates files, or mutates tasks.
 */
export function askThreadQuestion(
  threadId: string,
  question: string,
  previousTurns: ThreadAskTurn[] = [],
): ThreadAskTurn {
  const q = normalize(question);
  const reply =
    (threadId === "thr-cityhub" ? resolveCityHub(q, previousTurns) : null) ??
    resolveGeneric(q);

  return {
    id: `ask-${threadId}-${Date.now()}`,
    threadId,
    question: question.trim(),
    kind:
      reply.kind === "answer" &&
      !(reply.sourceMessageIds && reply.sourceMessageIds.length > 0)
        ? "not_found"
        : reply.kind,
    answer:
      reply.kind === "answer" &&
      !(reply.sourceMessageIds && reply.sourceMessageIds.length > 0)
        ? NOT_FOUND
        : reply.answer,
    sources: reply.sourceMessageIds ? sources(reply.sourceMessageIds) : [],
    clarificationOptions: reply.clarificationOptions,
    createdAt: new Date().toISOString(),
  };
}
