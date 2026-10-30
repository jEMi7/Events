const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

export type SheetTable = { headers: string[]; rows: string[][] };

export class SourceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceAccessError";
  }
}

function credentials() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["GOOGLE_SHEETS_API_KEY"];
  return { lovableKey, connectionKey };
}

export function sourceConnected() {
  const { lovableKey, connectionKey } = credentials();
  return Boolean(lovableKey && connectionKey);
}

export async function fetchTabs(
  spreadsheetId: string,
  tabs: string[],
): Promise<Record<string, SheetTable>> {
  const { lovableKey, connectionKey } = credentials();
  if (!lovableKey || !connectionKey) {
    throw new SourceAccessError(
      "Google Sheets is not connected for this project. Connect the source in Admin settings before syncing.",
    );
  }

  const params = new URLSearchParams();
  tabs.forEach((tab) => params.append("ranges", `${tab}!A1:AZ20000`));
  params.set("valueRenderOption", "UNFORMATTED_VALUE");
  params.set("dateTimeRenderOption", "FORMATTED_STRING");

  const response = await fetch(
    `${GATEWAY_URL}/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connectionKey,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`[sheets] batchGet failed [${response.status}]: ${body}`);
    throw new SourceAccessError(
      `Google Sheets returned ${response.status}. ${body.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as {
    valueRanges?: { range?: string; values?: unknown[][] }[];
  };

  const result: Record<string, SheetTable> = {};
  (payload.valueRanges ?? []).forEach((valueRange, index) => {
    const tab = tabs[index] ?? valueRange.range?.split("!")[0] ?? `tab_${index}`;
    const values = (valueRange.values ?? []).map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
    );
    const [headers = [], ...rows] = values;
    result[tab] = { headers, rows };
  });

  tabs.forEach((tab) => {
    if (!result[tab]) result[tab] = { headers: [], rows: [] };
  });

  return result;
}
