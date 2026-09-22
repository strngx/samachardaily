const articles = [
  {
    name: "Starlink / IRIS2",
    body: `SpaceX’s Starlink continues to consolidate its leadership in the global satellite broadband market, operating thousands of low Earth orbit (LEO) satellites to deliver high-speed connectivity across residential, commercial, maritime, and defense sectors. In response to Starlink’s growing footprint and commercial leverage, the European Union has committed €15.6 billion toward its sovereign IRIS² (Infrastructure for Resilience, Interconnectivity and Security by Satellite) constellation program.

The IRIS² initiative is structured as a multi-orbit public-private partnership involving major European aerospace primes, including Airbus Defence and Space, Thales Alenia Space, and satellite operators such as SES and Eutelsat. The architecture is designed to integrate Low Earth Orbit, Medium Earth Orbit, and Geostationary Earth Orbit satellites into a unified, secure communications network.

European policymakers framed the multi-billion-euro investment as a strategic necessity for continental technological sovereignty. The constellation is specifically engineered to provide quantum-encrypted, tamper-resistant communications for European government agencies, emergency response networks, and military command structures, while expanding high-speed broadband to remote regions and underserved transport corridors.

Industry analysts emphasize that while IRIS² represents Europe’s most ambitious space telecom commitment to date, Starlink maintains a substantial operational lead with active global infrastructure and rapid launch cadences. The European consortium is targeting initial multi-orbit constellation deployments between 2027 and 2030, establishing a long-term framework for sovereign space-based communications.`
  },
  {
    name: "Indian Gem & Jewellery Exports",
    body: `India's gems and jewellery export sector registered positive growth in August, with robust international demand for studded jewellery serving as the primary catalyst for overall trade performance. According to trade data released by the Gem & Jewellery Export Promotion Council (GJEPC), studded gold and precious metal jewellery shipments expanded by approximately 12.5% to reach $850 million during the monthly period.

The trade figures highlight significant divergence across product categories within the gems and jewellery basket. While studded jewellery and polished lab-grown diamonds (LGD) experienced double-digit export surges—with lab-grown diamond shipments climbing over 22%—traditional cut and polished diamonds (CPD) sourced from natural stones faced noticeable contraction. The decline in natural CPD exports reflects cautious global wholesale purchasing and elevated inventory levels across major international distribution hubs.

Export growth in the studded segment was bolstered by strong pre-festive order inflows from key overseas markets, particularly the United States and the United Arab Emirates under the Comprehensive Economic Partnership Agreement (CEPA). American retail buyers increased bookings for finished, high-margin studded jewellery collections ahead of the fourth-quarter holiday shopping season.

Manufacturing hubs in Surat, Mumbai, and Jaipur are adapting to these shifting trade dynamics. While natural diamond cutting and polishing units face margin compression, jewellery manufacturers are increasingly allocating factory capacity toward intricate studded designs and certified lab-grown diamond settings to capture expanding international market share.`
  },
  {
    name: "Ai+ Nova Tab India",
    body: `Consumer hardware brand Ai+ has confirmed the upcoming India launch of its latest tablet, the Ai+ Nova Tab, with retail distribution scheduled exclusively through e-commerce platform Flipkart. Official teaser pages published on the marketplace have revealed the tablet's exterior aesthetic, highlighting a flat metal frame, slim bezels, and a vibrant Sunset Orange color variant alongside traditional dark grey options.

The product teasers showcase a minimalist rear chassis featuring a square camera housing situated in the upper corner, complemented by centered brand insignia. On the hardware front, early specifications published ahead of the launch event indicate a 10.4-inch 2K IPS display engineered for video playback and digital reading, accompanied by quad stereo speakers and a 7,500mAh battery supporting USB-C fast charging.

The Ai+ Nova Tab is positioned to compete in the high-volume budget Android tablet segment, targeting an expected price point under ₹15,000. This entry seeks to capture demand from students, remote professionals, and casual media consumers looking for large-screen utility without the premium cost of flagship hardware.

E-commerce teasers indicate that the tablet will make its commercial debut in conjunction with Flipkart's upcoming festive sales events, offering introductory exchange bonuses and bank card cashbacks. Final retail configuration tiers, processing hardware details, and localized software features will be formally unveiled during the scheduled launch announcement.`
  },
  {
    name: "Apple iOS 27 Siri Third-Party AI",
    body: `Developer analysis of pre-release builds for Apple's iOS 27 and macOS platforms has uncovered private architectural frameworks designed to integrate third-party artificial intelligence models into system-level assistant workflows. Security researchers and developers reverse-engineering the frameworks discovered code paths that allow external large language models, including Anthropic’s Claude and OpenAI implementations, to handle complex tasks traditionally routed through Apple's server-side assistant infrastructure.

The technical mechanism relies on an expanded App Intents architecture and private SiriKit extension points. These interfaces allow users and enterprise developers to assign third-party AI applications to physical hardware triggers, such as the iPhone Action Button, or configure custom voice shortcuts to query external models directly without opening standalone client applications.

Industry observers clarify that the framework does not represent an unvetted removal of Siri's core on-device foundation. Instead, it provides a structured gateway where specialized queries, coding tasks, or creative writing prompts can be delegated to third-party models, with Apple's Private Cloud Compute maintaining data isolation, sandboxing, and local user privacy standards.

The architectural modularity aligns with Apple's broader compliance efforts under the European Union's Digital Markets Act (DMA), which mandates greater interoperability for core platform services. By opening standardized extension points for third-party assistants, Apple provides advanced users with customizable AI choices while maintaining the security boundaries of the wider iOS ecosystem.`
  },
  {
    name: "Cybersecurity Stocks Rally",
    body: `Shares of leading enterprise cybersecurity providers recorded strong gains during recent market sessions, with CrowdStrike, Palo Alto Networks, and SentinelOne advancing between 3.5% and 5.2% on elevated trading volume. The coordinated sector rally reflects heightened institutional demand for specialized digital defense providers following a wave of high-profile enterprise security incidents and cloud infrastructure vulnerabilities.

Market analysts attribute the upward momentum to resilient corporate IT budget allocations. Despite macroeconomic selectivity across general enterprise software spending, chief information officers (CIOs) and security leaders have prioritized cybersecurity investments, allocating expanded budgets toward Cloud Native Application Protection Platforms (CNAPP), automated endpoint remediation, and zero-trust identity architectures.

The growing complexity of artificial intelligence-enabled cyber threats has served as an additional catalyst for the sector. As malicious actors deploy automated vulnerability scanners and sophisticated phishing campaigns, enterprises are accelerating the migration away from fragmented point solutions toward consolidated, AI-driven security platforms offered by established industry leaders.

Strong quarterly annual recurring revenue (ARR) updates from major vendors have further reinforced investor confidence in the sector's long-term growth trajectory. While equity valuations in the cybersecurity segment remain closely tied to macroeconomic interest rate expectations, sustained enterprise spending to safeguard mission-critical data continues to underpin market interest.`
  }
];

articles.forEach((a, i) => {
  const words = a.body.trim().split(/\s+/).filter(Boolean).length;
  console.log(`Article ${i+1} (${a.name}): ${words} words`);
});
