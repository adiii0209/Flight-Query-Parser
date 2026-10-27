"""Starting point for a workspace's HR settings: the Time Tours letterhead, titles, and the offer letter and payslip templates.
Text can use {{name}}-style variables, **bold** and *italic*. Everything here is copied into the workspace on first use and is then editable."""

COMPANY = {
    "name": "TIME TOURS TECH PRIVATE LIMITED",
    "short_name": "TIME TOURS",
    "legal_name": "TIME TOURS TECH PVT LTD",
    "address": "13, Camac Street, 1st Floor\nKolkata 700017",
    "phone": "+91 33 400 11 333",
    "email": "mail@timetours.in",
    "logo": "/hr/static/timetours_logo.jpg",
}

SIGNATORY = {"name": "A Banerjee", "title": "Proprietor / Authorised Signatory"}

# a title decides which offer letter template a person gets; add your own (Consultant, Trainee...)
TITLES = [
    {"name": "Employee", "template": "employee"},
    {"name": "Intern", "template": "intern"},
]

EMPLOYEE_OFFER = {
    "label": "Employee offer letter",
    "letterhead": "company",
    "header_title": "",
    "vars": {"probation": "two months", "join_time": "11 A.M.", "office_hours": "11 A.M. to 7 P.M."},
    "blocks": [
        {"t": "p", "text": "Dear {{name}},"},
        {"t": "p", "text": "Following your Job Application, we are pleased to confirm your appointment with **{{company_legal}}**, Camac Street, as **{{title}}**."},
        {"t": "p", "text": "Your Joining Date is **{{join_date}}** at {{join_time}} (Our office hours are {{office_hours}})."},
        {"t": "h", "text": "Probation"},
        {"t": "p", "text": "You will be on a probation period for the first {{probation}}. Upon successfully completing the probation period, your employment will become of a permanent status."},
        {"t": "p", "text": "**Salary: ₹{{salary}}/- per month.** (Rupees {{salary_words}} Only)"},
        {"t": "p", "text": "You are entitled to leave as per Company policy."},
        {"t": "p", "text": "Further information governing your employment can be found in the signed contract as well as the Employee Policy document."},
        {"t": "p", "text": "If you have further questions, please contact me directly or simply approach the HR department."},
        {"t": "p", "text": "Congratulations on your appointment and welcome to {{company_short}}. We look forward to years of fruitful cooperation and success. We wish you the best of luck in your new post."},
        {"t": "sign", "text": "Thanking you,\n\n\n{{signatory_title}}\nFor {{company_legal}}"},
    ],
}

INTERN_OFFER = {
    "label": "Internship offer letter",
    "letterhead": "logo",
    "header_title": "Internship offer with {{company_short}}",
    "vars": {"duration": "5 months", "stipend": "5000", "notice": "21 days", "min_days": "20", "probation": "two weeks"},
    "blocks": [
        {"t": "p", "text": "Dear {{name}},"},
        {"t": "p", "text": "I am delighted & excited to welcome you to {{company_short}} as a **{{title}}**. At {{company_short}}, we believe that our team is our biggest strength and we take pride in hiring ONLY the best and the brightest. We are confident that you would play a significant role in the overall success of the venture and wish you the most enjoyable, learning packed and truly *meaningful* internship experience with {{company_short}}."},
        {"t": "p", "text": "Your appointment will be governed by the terms and conditions presented in the **Annexure A.**"},
        {"t": "p", "text": "We look forward to you joining us. Please do not hesitate to call us for any information you may need. Also, please sign the duplicate of this offer as your acceptance and forward the same to us."},
        {"t": "p", "text": "Congratulations!"},
        {"t": "sign", "text": "\n\n{{signatory_name}}"},
        {"t": "pb"},
        {"t": "h", "text": "Annexure A"},
        {"t": "p", "text": "You shall be governed by the following terms and conditions of service during your internship with {{company_short}}, and those may be amended from time to time."},
        {"t": "num", "text": "You are being hired as a **{{title}}**. As a {{title}} you would be responsible for undertaking multifaceted roles on Travel and Tourism as assigned to you by your mentor."},
        {"t": "num", "text": "Your date of joining is **{{join_date}}** and the duration of the internship would be **{{duration}}**. During this time you are expected to devote your time and efforts solely to {{company_short}} work and your college. You are also required to let your mentor know about forthcoming events (if there are any) in advance so that your work can be planned accordingly."},
        {"t": "num", "text": "All the work that you will produce at or in relation to {{company_short}} will be the intellectual property of {{company_short}}. You are not allowed to store, copy, sell, share, and distribute it to a third party under any circumstances. Similarly you are expected to refrain from talking about your work in public domains (both online such as blogging, social networking site and offline among your friends, college etc.) without prior discussion and approval with your mentor."},
        {"t": "num", "text": "We take data privacy and security very seriously and to maintain confidentiality of any students, customers, clients, and companies’ data and contact details that you may get access to during your internship will be your responsibility. {{company_short}} operates on zero tolerance principle with regard to any breach of data security guidelines. At the completion of the internship you are expected to hand over all {{company_short}} work/data stored on your Personal Computer to your mentor and delete the same from your machine."},
        {"t": "num", "text": "During the appointment period you shall not engage yourselves directly or indirectly or in any capacity in any other organization. In the event of breach of this condition, this appointment is liable to be terminated forthwith by the company. In addition, you shall be liable to pay liquidated damages to the Company of an extent estimated by the Company."},
        {"t": "num", "text": "Under normal circumstances either the company or you may terminate this association by providing a notice of {{notice}} without assigning any reason. However, the company may terminate this agreement forthwith under situations of in-disciplinary behaviors."},
        {"t": "num", "text": "You are expected to conduct yourself with utmost professionalism in dealing with your mentor, team members, colleagues, clients and customers and treat everyone with due respect."},
        {"t": "num", "text": "At {{company_short}} we love people who like to go beyond the normal call of duty and can think out of the box. Surprise us with your passion, intelligence, creativity and hardwork – and expect appreciation & rewards to follow."},
        {"t": "num", "text": "Expect constant and continuous objective feedback from your mentor and other team members and we encourage you to ask for and provide feedback at every possible opportunity. It’s your right to receive and give feedback – this is the ONLY way we all can continuously push ourselves to do better."},
        {"t": "num", "text": "Have fun at what you do and do the right thing – both the principles are core of what {{company_short}} stands for and we expect you to imbibe them in your day to day actions and continuously challenge us if we are falling short of expectations on either of them."},
        {"t": "num", "text": "You will be given an initial monthly stipend of **INR {{stipend}}/-** provided if you are able to complete a minimum of {{min_days}} days in office working days in a month, irrespective of public holidays, personal or medical leave. For the first {{probation}} you will be on probation and can be terminated without pay at any time if your work is not as per expectations of the company. If you do not complete the entire duration of the internship you will need to return any stipend that you have collected from the company. You will be provided a certificate and recommendation letter at the successful completion of your internship."},
        {"t": "pb"},
        {"t": "p", "text": "I have agreed, read and understood all the terms and conditions of this Internship letter as well as Annexure hereto and affix my signature in complete acceptance of the terms of the letter."},
        {"t": "accept", "text": "Date:\nSignature:\nPlace:\nName:"},
    ],
}

PAYSLIP = {
    "earnings": ["Basic", "House Rent Allowance"],
    "deductions": ["Income Tax", "Provident Fund", "Professional tax"],
    "footer": "-- This is a system-generated document. --",
    "accent": "#16a34a",
}

DEFAULT_CONFIG = {
    "company": COMPANY,
    "signatory": SIGNATORY,
    "titles": TITLES,
    "offers": {"employee": EMPLOYEE_OFFER, "intern": INTERN_OFFER},
    "payslip": PAYSLIP,
}
