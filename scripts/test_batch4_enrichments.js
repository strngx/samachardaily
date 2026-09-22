const matter = require('gray-matter');

const articles = [
  {
    name: "Amazon Alexa+",
    body: `Amazon has rolled out Alexa+, its next-generation generative AI personal assistant, for users across India, marking a significant expansion of the company's voice-first artificial intelligence portfolio. The updated assistant is engineered to understand conversational context and execute complex household requests without requiring users to repeat the wake word between sequential commands.

A central feature of the India deployment is localized linguistic support. Alexa+ introduces natural conversational capabilities in English, Hindi, and code-mixed Hinglish, enabling household members to switch between languages fluidly during everyday interactions. Amazon trained the system on localized linguistic nuances and regional phrasing to improve voice recognition accuracy across diverse Indian accents.

Beyond linguistic improvements, the platform integrates multi-turn reasoning capabilities. Users can string together complex smart home instructions, such as adjusting multiple room lights, configuring climate settings, and scheduling reminders in a single conversational prompt. The assistant also summarizes calendar appointments, answers open-ended research queries, and provides customized local service recommendations.

The service is launching initially through an Early Access preview program. During this introductory rollout, Indian customers with compatible devices can access Alexa+ features at no additional charge. Hardware compatibility includes Echo Show smart displays, fourth-generation and fifth-generation Echo Dot speakers, and the updated Alexa mobile application on iOS and Android. Amazon noted that broader commercial access will eventually transition into structured subscription tiers alongside legacy Alexa functionality.`
  },
  {
    name: "Apple iOS 27",
    body: `Apple has officially released iOS 27 to the public, delivering a comprehensive overhaul of Siri alongside a suite of system-wide Apple Intelligence upgrades for compatible iPhone models. First previewed at WWDC 2026, the update underwent several months of developer and public beta testing prior to its worldwide launch, which aligns with the commercial debut of the iPhone 18 and iPhone 18 Pro lineup.

The central pillar of iOS 27 is a redesigned Siri assistant powered by on-device large language models. Siri now features full on-screen awareness, allowing the assistant to understand context from active applications and execute multi-step actions across first-party and supported third-party apps without manual app-switching. The interface also includes a redesigned glowing edge animation and improved tolerance for conversational pauses and self-corrections.

System-wide generative capabilities have been integrated throughout the operating system. iOS 27 introduces Writing Tools across Mail, Messages, and Notes, enabling users to rewrite, proofread, and summarize text directly within system text fields. In the Photos application, enhanced natural-language search allows users to find specific video moments and photos using descriptive queries, while the Clean Up tool removes unwanted background objects without degrading image quality.

Hardware requirements remain a key consideration for users. Advanced on-device Apple Intelligence capabilities require devices equipped with an A17 Pro processor or later, paired with a minimum of 8GB of unified memory. Standard iOS 27 interface refinements, security patches, and lock screen customizations remain available across all supported legacy iPhone generations.`
  },
  {
    name: "Trump AI Data Centers",
    body: `Former President Donald Trump characterized artificial intelligence data centers as the "oil of the next 50 years" during recent campaign remarks, framing computing infrastructure as the decisive economic and industrial asset of the coming decades. Addressing business and community leaders, Trump emphasized that rapid domestic expansion of hyperscale computing facilities is essential for maintaining technological leadership against international competitors.

During his address, Trump criticized major technology firms, specifically singling out Google for placing significant data center investments outside the United States. He argued that federal permitting delays and regulatory hurdles have encouraged corporations to build critical artificial intelligence facilities abroad rather than investing directly in American energy markets and local communities.

The remarks spotlight growing national scrutiny over the enormous electrical power and water demands required to operate gigawatt-scale AI infrastructure. High-density server clusters supporting advanced generative models consume substantial baseline power, creating capacity debates among municipal utility regulators in key data center hubs across Virginia, Texas, and the Midwest.

In response to infrastructure challenges, technology hyperscalers including Google, Microsoft, and Amazon have increasingly negotiated dedicated clean-energy Power Purchase Agreements (PPAs) and private nuclear microgrid partnerships. Industry analysts note that while AI data centers generate substantial local property tax revenues and construction employment, balancing regional grid stability with long-term commercial energy procurement remains a central challenge for local policymakers.`
  },
  {
    name: "CPSC Finger-Light Recall",
    body: `The U.S. Consumer Product Safety Commission (CPSC) has issued an urgent recall covering approximately 350,000 units of multi-colored LED finger-light toys sold exclusively on Amazon. The federal regulatory agency announced the recall following safety evaluations which revealed that the toys' battery compartments can easily detach or open during routine play, exposing loose button-cell lithium batteries.

According to the safety bulletin, the products fail to meet mandatory federal safety standards established under Reese's Law, which requires secure, child-resistant closures on all consumer products containing coin and button-cell batteries. If ingested, button-cell batteries can become lodged in a child's esophagus, causing severe chemical burns, internal tissue perforation, and fatal injuries within as little as two hours. In addition to chemical hazards, the small batteries pose an immediate choking risk for young children.

The recall encompasses bulk packs of elastic-band LED finger lights marketed by multiple third-party sellers across the Amazon marketplace between 2024 and 2026. The toys were packaged in multi-colored assortments commonly distributed as party favors, classroom rewards, and festival novelties.

Federal safety officials strongly urge parents and caregivers to locate the recalled finger-light toys and immediately take them away from children. Consumers should safely dispose of the items or contact the respective importers and distributors through Amazon's customer support portal to request a full purchase refund.`
  },
  {
    name: "GCRTA Transit Service Cuts",
    body: `The Greater Cleveland Regional Transit Authority (GCRTA) Board of Trustees has voted to defer scheduled transit service reductions until after the May 2027 election, providing temporary relief for thousands of daily transit riders across Cuyahoga County. The decision was reached following a series of public hearings during which commuters, transit advocates, and local workers testified about the disruptive impact of proposed frequency cutbacks.

The transit agency is confronting an estimated $30 million annual operating budget deficit. The structural shortfall has been driven by the exhaustion of federal pandemic relief funding, increased equipment maintenance costs, and persistent shifts in downtown commuting habits. To address the gap, regional leaders have proposed placing a dedicated sales tax referendum before county voters in the spring 2027 municipal elections.

The deferred reduction plan had proposed eliminating underutilized bus routes, reducing weekend service frequencies on key urban corridors, and curtailing late-night operations on the Red Line heavy rail and Blue-Green Line light rail networks. Transit officials warned that delaying these adjustments depletes existing reserve funds to maintain current operational schedules.

GCRTA executive leadership emphasized that the temporary reprieve hinges entirely on the outcome of the 2027 ballot initiative. If voters reject the proposed countywide revenue measure, the transit authority cautioned that it will be forced to implement significantly deeper service cuts and fare adjustments starting in the second half of 2027.`
  }
];

articles.forEach((art, i) => {
  const words = art.body.trim().split(/\s+/).filter(Boolean).length;
  console.log(`Article ${i+1} (${art.name}): ${words} words`);
});
