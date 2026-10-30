import type { Procedure } from "./types";

// Ready-made procedures, so a first-time visitor sees Spotter working within seconds.
// Custom tasks go through the Tavily + Nemotron 3 Ultra compiler instead.

export const PRESETS: Procedure[] = [
  {
    id: "ors",
    task: "Prepare ORS (oral rehydration solution) for a child with diarrhoea",
    summary:
      "Wrongly mixed ORS (too little water, half a packet) is a known cause of harm. Spotter checks that each step of the WHO/UNICEF method actually happens.",
    setupTip: "Put the camera above the table so the container, water and packet are all in view.",
    steps: [
      {
        id: "s1",
        title: "Wash hands with soap",
        instruction: "Wash your hands with soap and water before touching the container or packet.",
        visualCheck: "Hands are washed with soap, or hands are visibly wet or being dried before handling the items.",
        safetyCritical: true,
        watchFor: ["Handling the packet before washing"],
      },
      {
        id: "s2",
        title: "Use a clean container",
        instruction: "Take a clean container that holds at least 1 litre.",
        visualCheck: "A clean, empty jug, bottle or bowl large enough for 1 litre is placed in view.",
        safetyCritical: false,
        watchFor: ["A visibly dirty container", "A small cup instead of a 1-litre container"],
      },
      {
        id: "s3",
        title: "Pour exactly 1 litre of clean water",
        instruction: "Pour 1 litre of clean drinking water (boiled and cooled if unsure) into the container.",
        visualCheck: "Water is poured into the container, filling it to about the 1-litre level or a measured 1-litre bottle is emptied in.",
        safetyCritical: true,
        watchFor: ["Pouring much less than 1 litre", "Using juice, milk or soft drink instead of water"],
      },
      {
        id: "s4",
        title: "Empty the whole ORS packet",
        instruction: "Open one ORS packet and empty all of the powder into the water.",
        visualCheck: "An ORS sachet is opened and its full contents are poured into the container; the empty sachet is visible.",
        safetyCritical: true,
        watchFor: ["Adding only part of the packet", "Adding sugar or salt on top"],
      },
      {
        id: "s5",
        title: "Stir until fully dissolved",
        instruction: "Stir with a clean spoon until all the powder has dissolved.",
        visualCheck: "A spoon is stirring the liquid and no powder remains floating or settled.",
        safetyCritical: false,
        watchFor: ["Stopping while powder is still visible"],
      },
      {
        id: "s6",
        title: "Cover and note the time",
        instruction: "Cover the container. Throw away any ORS left after 24 hours.",
        visualCheck: "The container is covered with a lid or cloth.",
        safetyCritical: false,
        watchFor: ["Leaving it uncovered"],
      },
    ],
    sources: [
      { title: "CDC: How to make oral rehydration solution (ORS)", url: "https://www.cdc.gov/global-water-sanitation-hygiene/media/pdfs/11_229310-j_ors_print-africa.pdf" },
      { title: "UNICEF Supply Division: Oral rehydration salts (ORS) and zinc", url: "https://www.unicef.org/supply/oral-rehydration-salts-ors-and-zinc" },
    ],
    compiledBy: "Preset, based on WHO/UNICEF/CDC guidance",
  },
  {
    id: "handwash",
    task: "WHO hand-washing technique",
    summary:
      "Food handlers and clinic staff are trained on the WHO technique, but nobody checks it in practice. Spotter watches each movement.",
    setupTip: "Point the camera at the sink from the side, about an arm's length away, so both hands stay in frame.",
    steps: [
      { id: "s1", title: "Wet hands", instruction: "Wet your hands with water.", visualCheck: "Both hands under running water.", safetyCritical: false, watchFor: [] },
      { id: "s2", title: "Apply soap", instruction: "Apply enough soap to cover all hand surfaces.", visualCheck: "Soap dispensed or bar soap rubbed onto the hands; lather starting.", safetyCritical: true, watchFor: ["Skipping soap"] },
      { id: "s3", title: "Palm to palm", instruction: "Rub hands palm to palm.", visualCheck: "Palms pressed together and rubbing back and forth.", safetyCritical: false, watchFor: [] },
      { id: "s4", title: "Backs of hands", instruction: "Right palm over the back of the left hand with interlaced fingers, then swap.", visualCheck: "One palm rubbing over the back of the other hand, fingers interlaced.", safetyCritical: false, watchFor: ["Only doing one hand"] },
      { id: "s5", title: "Between fingers", instruction: "Palm to palm with fingers interlaced.", visualCheck: "Palms together with fingers interlaced, sliding between each other.", safetyCritical: false, watchFor: [] },
      { id: "s6", title: "Thumbs", instruction: "Rotational rubbing of each thumb clasped in the opposite palm.", visualCheck: "One hand clasping and rotating around the other thumb.", safetyCritical: false, watchFor: ["Thumbs are the most-missed area"] },
      { id: "s7", title: "Fingertips", instruction: "Rub the fingertips of each hand in the opposite palm.", visualCheck: "Fingertips bunched and rubbed in a circular motion in the other palm.", safetyCritical: false, watchFor: [] },
      { id: "s8", title: "Rinse", instruction: "Rinse hands with water.", visualCheck: "Hands under running water, soap washing off.", safetyCritical: true, watchFor: ["Leaving soap on"] },
      { id: "s9", title: "Dry with single-use towel", instruction: "Dry thoroughly with a single-use towel and use it to turn off the tap.", visualCheck: "Hands dried with a paper or single-use towel.", safetyCritical: false, watchFor: ["Wiping on clothes"] },
    ],
    sources: [{ title: "WHO: How to handwash (poster)", url: "https://www.who.int/docs/default-source/patient-safety/how-to-handwash-poster.pdf" }],
    compiledBy: "Preset, based on the WHO hand-washing poster",
  },
  {
    id: "ram",
    task: "Upgrade the RAM in a laptop",
    summary:
      "Repair-shop trainees and DIYers fry boards by working on a laptop that's still powered. Spotter refuses to let you open the case until power is confirmed off.",
    setupTip: "Mount the camera above the desk looking down at the laptop.",
    steps: [
      { id: "s1", title: "Shut down", instruction: "Fully shut down the laptop (not sleep).", visualCheck: "The screen is off and no power LEDs are lit.", safetyCritical: true, watchFor: ["Laptop only closed or sleeping"] },
      { id: "s2", title: "Unplug the charger", instruction: "Disconnect the charger and any cables.", visualCheck: "No power cable is connected to the laptop.", safetyCritical: true, watchFor: ["Charger still plugged in"] },
      { id: "s3", title: "Ground yourself", instruction: "Touch a grounded metal object or wear an anti-static strap.", visualCheck: "Hand touching bare metal (case, radiator) or an anti-static wrist strap is visible.", safetyCritical: true, watchFor: ["Working on carpet without grounding"] },
      { id: "s4", title: "Remove the bottom panel", instruction: "Flip the laptop over and remove the bottom-panel screws.", visualCheck: "The laptop is upside down and screws are being removed or the panel is off.", safetyCritical: false, watchFor: ["Losing screws, keep them in a tray"] },
      { id: "s5", title: "Disconnect the battery", instruction: "If the battery is internal, unplug its connector before touching the RAM.", visualCheck: "The battery connector is unplugged from the motherboard.", safetyCritical: true, watchFor: ["Touching the RAM with the battery connected"] },
      { id: "s6", title: "Swap the RAM module", instruction: "Release the clips, remove the old module, and insert the new one at about 30° until it clicks.", visualCheck: "A RAM stick is inserted at an angle and pressed down until the side clips lock.", safetyCritical: false, watchFor: ["Touching the gold contacts", "Forcing it in the wrong way round"] },
      { id: "s7", title: "Reassemble", instruction: "Reconnect the battery, refit the panel and screws.", visualCheck: "The bottom panel is back on and screws are being tightened.", safetyCritical: false, watchFor: [] },
    ],
    sources: [{ title: "HP Tech Takes: How to install RAM", url: "https://www.hp.com/us-en/tech-takes/components/how-to/how-to-install-ram-on-motherboard.html" }],
    compiledBy: "Preset, based on manufacturer guidance",
  },
];
