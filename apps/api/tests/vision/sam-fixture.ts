/**
 * Real one_bit payload for a 6x4 raster, generated offline with the
 * official encoder (encodeSegmentationMask) and hardcoded so tests
 * never depend on parser internals.
 */
export const MASK_6X4 = "!!!!!)Hl*&R0zEZ";

export function samRecord(
  objectId: string,
  box: string,
  maskData = `4,6,${MASK_6X4}`,
): string {
  return `${objectId}<|box;${box}|><|mask;x=0;y=0;data=${maskData}|>`;
}

export function samLane(...records: string[]): string {
  return `<0f>${records.join(",")}`;
}

export function samSse(laneText: string): Response {
  const event = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
  const body =
    event({
      type: "response.content_part.done",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: laneText },
    }) + event({ type: "response.completed" });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}
