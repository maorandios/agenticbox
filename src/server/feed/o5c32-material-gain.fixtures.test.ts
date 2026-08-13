/**
 * O5C.3.2 — Material gain fixtures (no Live OpenAI).
 */
import { describe, expect, it } from "vitest";
import { classifyMaterialGain } from "@/server/feed/material-gain";

describe("O5C.3.2 classifyMaterialGain", () => {
  it("restatement_only when history only repeats plans were sent", () => {
    const out = classifyMaterialGain({
      triggerText:
        "איתי שלום, בהמשך לדיון מצורפות כעת התוכניות למדרגות הפלדה בקומות 1,3,5",
      currentThreadText: "",
      historicalExcerpts: [
        {
          threadId: "22222222-2222-4222-8222-222222222222",
          excerpt: "שלום, מצורפות התוכניות למדרגות כפי שדיברנו",
        },
      ],
      resolution: {
        status: "resolved",
        items: [
          {
            type: "change",
            headline: "נשלחו תוכניות מדרגות",
            evidenceText: "מצורפות התוכניות",
            supportingSources: [
              {
                role: "trigger",
                threadId: "11111111-1111-4111-8111-111111111111",
                evidence: "מצורפות כעת התוכניות",
              },
              {
                role: "historical",
                threadId: "22222222-2222-4222-8222-222222222222",
                evidence: "מצורפות התוכניות",
              },
            ],
          },
        ],
        supportingSources: [],
      },
    });
    expect(out.materialGain).toBe("restatement_only");
    expect(out.displayStatus).not.toBe("resolved");
  });

  it("material when history adds prior requested object/version", () => {
    const out = classifyMaterialGain({
      triggerText: "מצורפות כעת התוכניות למדרגות בקומות 1,3,5",
      currentThreadText: "",
      historicalExcerpts: [
        {
          threadId: "22222222-2222-4222-8222-222222222222",
          excerpt:
            "Please send STAIRS WAIZMAN -2 REV-1.rar as requested in the site survey commitment",
        },
      ],
      resolution: {
        status: "resolved",
        items: [
          {
            type: "change",
            headline: "נשלחה גרסת REV-1 לפי בקשה קודמת מהסיור",
            supportingSources: [
              {
                role: "trigger",
                threadId: "11111111-1111-4111-8111-111111111111",
                evidence: "מצורפות כעת התוכניות",
              },
              {
                role: "historical",
                threadId: "22222222-2222-4222-8222-222222222222",
                evidence: "send STAIRS WAIZMAN -2 REV-1 as requested",
              },
            ],
          },
        ],
        supportingSources: [
          {
            role: "historical",
            threadId: "22222222-2222-4222-8222-222222222222",
            evidence: "STAIRS WAIZMAN -2 REV-1 as requested in the site survey commitment",
          },
        ],
      },
    });
    expect(out.materialGain).toBe("material");
    expect(out.displayStatus).toBe("resolved");
    expect(out.wouldAddFeedValue).toBe(true);
  });

  it("insufficient when completion is insufficient", () => {
    const out = classifyMaterialGain({
      triggerText: "hello",
      currentThreadText: "",
      historicalExcerpts: [],
      resolution: {
        status: "insufficient",
        items: [],
        supportingSources: [],
      },
    });
    expect(out.materialGain).toBe("insufficient");
  });
});
