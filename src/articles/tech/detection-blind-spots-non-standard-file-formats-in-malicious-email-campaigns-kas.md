---
title: "Kaspersky warns of hidden malware in exotic file formats used in email attacks"
category: "Tech"
date: 2026-08-29T05:13:10Z
image: "https://upload.wikimedia.org/wikipedia/commons/0/0d/Msc2012_20120205_144_Kaspersky_Kai_Moerk.jpg"
imageAlt: "48th Munich Security Conference 2012: Eugene Kaspersky, Chairman and CEO, Kaspersky Lab, Moscow."
imageCredit: "Kai Mörk / Wikimedia Commons"
imageLicense: "CC BY 3.0 de"
imageSourceUrl: "https://commons.wikimedia.org/wiki/File:Msc2012_20120205_144_Kaspersky_Kai_Moerk.jpg"
video_id: ""
video_caption: ""
slug: "detection-blind-spots-non-standard-file-formats-in-malicious-email-campaigns-kas"
sourceUrl: "https://www.kaspersky.co.in/blog/exotic-file-formats-detection-gaps-iso-one-xll-svg/31009/"
sourceName: "Kaspersky"
dek: "Cybercriminals are increasingly using uncommon file types such as disk images, atypical Office add‑ins and vector graphics to slip malware past traditional email scanners, according to Kaspersky research."
author: "SamacharDaily Editorial Team"
why_it_matters: |
  Email remains the most prevalent entry point for malware, and the emergence of exotic file formats erodes the effectiveness of legacy defenses that rely on static signatures. When malicious payloads bypass initial scans, they can gain a foothold in corporate networks, leading to data theft, ransomware encryption or lateral movement across systems. For organisations, this translates into higher remediation costs, potential regulatory penalties and damage to reputation. The findings underscore the need for security teams to adopt more holistic, context‑aware scanning solutions and to keep pace with attackers’ evolving tactics. By recognising and mitigating these blind spots, enterprises can close a critical gap in their cyber‑defence posture before the next wave of sophisticated email‑borne attacks strikes.
---
Kaspersky’s research team has identified a growing trend where threat actors embed malicious code in file formats that are rarely inspected by conventional security solutions. The study highlights a range of "exotic" containers – from ISO disk images and XLL Excel add‑ins to SVG vector graphics and polyglot files that masquerade as legitimate documents. By exploiting the fact that many anti‑virus engines focus on well‑known extensions like .exe, .docx or .pdf, attackers can deliver payloads that remain invisible until the user opens the attachment or the file is mounted on a system.

Real‑world campaigns cited by Kaspersky illustrate the danger. In one case, a phishing email carried an ISO image that, when mounted, automatically launched a ransomware dropper hidden in the disc’s hidden folder. Another operation used a malicious XLL file – an Excel add‑in – to execute PowerShell commands that downloaded a banking trojan. SVG files, which are normally used for scalable graphics, were weaponised with embedded JavaScript that triggered drive‑by downloads when rendered in a webmail client. The most sophisticated examples involved polyglot files that behaved simultaneously as a PDF and a Windows executable, confusing signature‑based scanners that only parsed one format. These techniques expose a blind spot in many corporate email gateways and endpoint protection products that do not fully unpack or analyse the inner structure of such containers.

Kaspersky advises security vendors to broaden their inspection capabilities to include these less common formats and to adopt behavior‑based detection that watches for suspicious actions regardless of file type. The firm also recommends regular updates to signature databases, sandboxing of attachments, and user awareness training to discourage opening unexpected files, especially from unknown senders.
