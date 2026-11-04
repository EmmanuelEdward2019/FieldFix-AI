import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Leaflet touches window at import; the component only uses it inside
// effects, which never run during server rendering.
vi.mock("leaflet", () => ({ default: {} }));

import { TechnicianMap } from "../components/technician-map";

describe("TechnicianMap", () => {
  it("server-renders a labelled map region without touching the DOM", () => {
    const html = renderToString(
      React.createElement(TechnicianMap, {
        points: [{ id: "t1", name: "Ada Repairs", lat: 6.45, lng: 3.39, detail: "Lagos · 2.0 km away" }],
        origin: { lat: 6.5, lng: 3.4 },
      }),
    );
    expect(html).toContain("Map of nearby technicians");
    expect(html).toContain("rounded-xl");
  });
});
