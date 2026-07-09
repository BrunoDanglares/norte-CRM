const GRAPH_API = "https://graph.facebook.com/v21.0";

export async function submitTemplate(params: {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string;
  templateName: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  headerType?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO" | null;
  headerContent?: string;
  bodyText: string;
  footerText?: string;
  buttons?: Array<{
    type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
    text: string;
    url?: string;
    phone?: string;
  }>;
}): Promise<{ templateId: string; status: string }> {
  const components: any[] = [];

  if (params.headerType) {
    components.push({ type: "HEADER", format: params.headerType, text: params.headerContent });
  }

  components.push({ type: "BODY", text: params.bodyText });

  if (params.footerText) {
    components.push({ type: "FOOTER", text: params.footerText });
  }

  if (params.buttons && params.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: params.buttons.map((b) => {
        if (b.type === "URL") return { type: "URL", text: b.text, url: b.url };
        if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone };
        return { type: "QUICK_REPLY", text: b.text };
      }),
    });
  }

  const url = `${GRAPH_API}/${params.wabaId}/message_templates`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      name: params.templateName,
      category: params.category,
      language: params.language,
      components,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || `Meta API error: ${res.status}`);
  }

  return { templateId: data.id, status: data.status || "PENDING" };
}

export async function syncTemplateStatus(params: {
  wabaId: string;
  accessToken: string;
  templateName: string;
  language: string;
}): Promise<{ status: string; rejectionReason?: string } | null> {
  try {
    const url = `${GRAPH_API}/${params.wabaId}/message_templates?name=${encodeURIComponent(params.templateName)}&fields=name,status,language,rejected_reason`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const data = await res.json();
    if (!res.ok || !data.data) return null;

    const match = data.data.find(
      (t: any) => t.name === params.templateName && t.language === params.language
    );
    if (!match) return null;

    return {
      status: match.status,
      rejectionReason: match.rejected_reason || undefined,
    };
  } catch {
    return null;
  }
}

export async function listMetaTemplates(params: {
  wabaId: string;
  accessToken: string;
}): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    language: string;
    category: string;
    rejectedReason?: string;
  }>
> {
  try {
    const url = `${GRAPH_API}/${params.wabaId}/message_templates?fields=id,name,status,language,category,rejected_reason&limit=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const data = await res.json();
    if (!res.ok || !data.data) return [];

    return data.data.map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      language: t.language,
      category: t.category,
      rejectedReason: t.rejected_reason || undefined,
    }));
  } catch {
    return [];
  }
}

export function countTemplateVariables(text: string): number {
  const matches = text.match(/\{\{\d+\}\}/g);
  return matches ? matches.length : 0;
}
