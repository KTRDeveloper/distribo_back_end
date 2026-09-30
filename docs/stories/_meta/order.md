# Implementation order

Topological order of depends_on: modules in dependency order, then story number.

1. FND-000 Add the missing quality gates and load the conventions (foundation)
2. FND-001 Reset the database schema and the migration history (foundation)
3. FND-002 Create the application database role and the server-time trigger (foundation)
4. FND-003 Shared money and quantity arithmetic (foundation)
5. FND-004 Shared phone number normalization (foundation)
6. FND-005 Shared identifiers and column type helper (foundation)
7. FND-006 Shared HTTP error helper (foundation)
8. FND-007 Stop Prisma from logging queries (foundation)
9. FND-008 Default JSON body limit of 100 kb (foundation)
10. FND-009 Shared limits and pagination helpers (foundation)
11. PER-001 Retire the old sign-in module (person)
12. PER-002 Replace the legacy Person and Account with the v10 Person table (person)
13. PER-003 Person integrity checks in the database (person)
14. PER-004 Phone number change journal (person)
15. PER-005 Person repository contract and public view (person)
16. PER-006 Look up a person by phone number (person)
17. PER-007 Person reads and edits their own profile (person)
18. PER-008 Registered-person guard for author columns (person)
19. ACC-001 Role order and ability builder (access)
20. ACC-002 Rules for relationships, catalog and prices (access)
21. ACC-003 Rules for orders and deliveries (access)
22. ACC-004 Rules for money (access)
23. ACC-005 Rules for team, subscription and organization (access)
24. ACC-006 Ability middleware (access)
25. ACC-007 Idempotency of online gestures (access)
26. NTF-001 Notifications table (notification)
27. NTF-002 Notify service (notification)
28. NTF-003 Person lists their notifications (notification)
29. NTF-004 Person marks notifications as read (notification)
30. AUTH-001 One-time code table (auth)
31. AUTH-002 Issue a one-time code (auth)
32. AUTH-003 Verify a one-time code (auth)
33. AUTH-004 Device, IP and daily caps on code sending (auth)
34. AUTH-005 Password rules and Argon2id hashing (auth)
35. AUTH-006 Access token carries the person and the device (auth)
36. AUTH-007 Device and refresh token tables (auth)
37. AUTH-008 Issue and revoke sessions (auth)
38. AUTH-009 Visitor asks for a registration code (auth)
39. AUTH-010 Visitor registers with the code (auth)
40. AUTH-011 New holder of a recycled number registers (auth)
41. AUTH-012 Failed-attempt counter and lock duration (auth)
42. AUTH-013 Person signs in with number and password (auth)
43. AUTH-014 Person completes sign-in with the code (auth)
44. AUTH-015 Person whose number was taken signs in with the verified email (auth)
45. AUTH-016 Refresh a session with rotation (auth)
46. AUTH-017 Person signs out of this phone (auth)
47. AUTH-018 Person manages their phones (auth)
48. AUTH-019 Person asks for a password reset code (auth)
49. AUTH-020 Person chooses a new password with the code (auth)
50. AUTH-021 Person changes their password (auth)
51. AUTH-022 Person asks for an email verification code (auth)
52. AUTH-023 Person confirms their email (auth)
53. AUTH-024 Person asks to change their phone number (auth)
54. AUTH-025 Person moves their account to the new number (auth)
55. AUTH-026 Drop the bcrypt dependency (auth)
56. ORG-001 Organizations table (organization)
57. ORG-002 Notifications point to organizations (organization)
58. ORG-003 Collaborations table (organization)
59. ORG-004 Registered person creates an organization (organization)
60. ORG-005 Actor loading and reading my organizations (organization)
61. ORG-006 Amount held helper (organization)
62. ORG-007 Owner invites a collaborator by phone number (organization)
63. ORG-008 Invited person answers an invitation (organization)
64. ORG-009 Owner changes a collaborator's role (organization)
65. ORG-010 Owner revokes a collaborator (organization)
66. ORG-011 Collaborator agrees to be a public contact (organization)
67. ORG-012 Subscription table (organization)
68. ORG-013 Owner starts a subscription (organization)
69. ORG-014 Owner ends the subscription (organization)
70. ORG-015 Owner transfers the ownership (organization)
71. ORG-016 Owner closes the business (organization)
72. ORG-017 Owner reopens the business (organization)
73. ORG-018 Find a business by a public phone number (organization)
74. ORG-019 Team list (organization)
75. REL-001 Relationships table (relationship)
76. REL-002 Party and pair rules in the database (relationship)
77. REL-003 Credit limit journal table (relationship)
78. REL-004 Credit limit rules and journal trigger (relationship)
79. REL-005 Visibility predicate and party projections (relationship)
80. REL-006 Every new organization gets its first counter (relationship)
81. REL-007 Seller adds a customer by phone number (relationship)
82. REL-008 Seller lists the customers (relationship)
83. REL-009 Seller opens one customer (relationship)
84. REL-010 Seller edits the supplier-side fields (relationship)
85. REL-011 Manager adds a counter (relationship)
86. REL-012 Owner or manager sets a credit limit (relationship)
87. REL-013 Owner reads the credit limit history (relationship)
88. REL-014 Reassignment journal table (relationship)
89. REL-015 Manager ends and reopens a relationship as supplier (relationship)
90. REL-016 Customer lists their suppliers (relationship)
91. REL-017 Customer names, ends and reopens a supplier (relationship)
92. REL-018 Organization lists and names its suppliers (relationship)
93. REL-019 Organization ends and reopens a supplier (relationship)
94. REL-020 Customer invites a supplier by phone number (relationship)
95. REL-021 Invited supplier accepts or declines (relationship)
96. REL-022 Newly registered person sees what is attached to their number (relationship)
97. REL-023 Customer contests a relationship ("this is not me") (relationship)
98. REL-024 Owner or manager corrects a customer's number (relationship)
99. REL-025 Merge a duplicate customer record (relationship)
100. ADM-001 Administrators table (admin)
101. ADM-002 Administration journal table (admin)
102. ADM-003 Reports table (admin)
103. ADM-004 Two-factor codes for administrators (admin)
104. ADM-005 Create the first super administrator from the command line (admin)
105. ADM-006 Administrator signs in with password and authenticator code (admin)
106. ADM-007 Administrator registers a recovery email (admin)
107. ADM-008 Administrator reinstalls the authenticator through the recovery email (admin)
108. ADM-009 Super administrator appoints an administrator (admin)
109. ADM-010 Super administrator removes an administrator (admin)
110. ADM-011 Person reports another person or a business (admin)
111. ADM-012 Administrator lists and opens reports (admin)
112. ADM-013 Administrator resolves a report (admin)
113. ADM-014 Administrator suspends or reactivates without a report (admin)
114. ADM-015 Administrators read the action journal (admin)
115. CAT-001 Products table (catalog)
116. CAT-002 Negotiated prices table (catalog)
117. CAT-003 Reference price and active product lookup (catalog)
118. CAT-004 Manager creates a product (catalog)
119. CAT-005 Manager edits and retires a product (catalog)
120. CAT-006 Seller lists the catalog (catalog)
121. CAT-007 Customer browses a supplier's catalog (catalog)
122. CAT-008 Owner or manager sets a negotiated price (catalog)
123. CAT-009 Owner or manager removes a negotiated price and reads them (catalog)
124. CAT-010 Manager copies negotiated prices between customers (catalog)
125. CAT-011 Reseller copies a purchased article into their catalog (catalog)
126. ORD-001 Orders table (order)
127. ORD-002 Order status, cancellation and delivery rules in the database (order)
128. ORD-003 Orders only on live relationships of active organizations (order)
129. ORD-004 Order lines table (order)
130. ORD-005 Order line product and minimum quantity rules (order)
131. ORD-006 Order total equals the sum of its lines (order)
132. ORD-007 Order calculations and party views (order)
133. ORD-008 Order state machine (order)
134. ORD-009 Customer places an order (order)
135. ORD-010 Organization manager orders from a supplier (order)
136. ORD-011 Supplier accepts an order, lowering prices if needed (order)
137. ORD-012 Supplier refuses an order (order)
138. ORD-013 Seller enters an order for a customer (order)
139. ORD-014 Seller edits an order they entered, before departure (order)
140. ORD-015 Seller writes a note on an order at any time (order)
141. ORD-016 Supplier cancels an order before departure (order)
142. ORD-017 Customer cancels an order before departure (order)
143. ORD-018 Closing a business refuses its pending orders (order)
144. ORD-019 Seller lists the orders (order)
145. ORD-020 Seller opens one order (order)
146. ORD-021 Customer lists and opens their orders (order)
147. FIN-001 Ledger entries table (finance)
148. FIN-002 Ledger sale and reversal rules in the database (finance)
149. FIN-003 Append a ledger entry and update the caches (finance)
150. FIN-004 Seller records a payment (finance)
151. FIN-005 Manager returns money to a customer (finance)
152. FIN-006 Manager grants a credit note (finance)
153. FIN-007 Manager records an opening balance from a paper notebook (finance)
154. FIN-008 Manager records a refunded return (finance)
155. FIN-009 Manager reverses a ledger entry (finance)
156. FIN-010 Parties read the ledger of a relationship (finance)
157. FIN-011 Expenses table (finance)
158. FIN-012 Manager records an expense (finance)
159. FIN-013 Manager cancels an expense (finance)
160. FIN-014 Handovers table (finance)
161. FIN-015 Owner or manager records a handover received (finance)
162. FIN-016 Cancel a handover and dispute the noted amount (finance)
163. FIN-017 Ownership transfer hands over the former owner's money (finance)
164. FIN-018 Nightly check of balances and held money (finance)
165. FIN-019 Owner reads the money exceptions (finance)
166. FIN-020 Owner reads the treasury and expenses (finance)
167. DLV-001 Deliveries table (delivery)
168. DLV-002 Delivery state rules in the database (delivery)
169. DLV-003 Driver sees the orders to deliver (delivery)
170. DLV-004 Manager assigns an order to a driver (delivery)
171. DLV-005 Driver departs with an order (delivery)
172. DLV-006 Driver reports a failed delivery (delivery)
173. DLV-007 "Commande livrée": deliver a whole order and record the sale and the payment (delivery)
174. DLV-008 Deliver only part of an order and settle the rest (delivery)
175. DLV-009 Seller validates a counter sale (delivery)
176. DLV-010 Cancelled or shop-delivered orders drop their unstarted deliveries (delivery)
177. DLV-011 Owner reviews unsettled deliveries of the day (delivery)
178. DLV-012 Abandoned rests join the owner's money exceptions (delivery)
179. SYNC-001 Sync types, adapter registry and viewer (sync)
180. SYNC-002 Sync archive table (sync)
181. SYNC-003 Pull endpoint and identity tables (sync)
182. SYNC-004 Pull relationships and negotiated prices (sync)
183. SYNC-005 Pull the catalog (sync)
184. SYNC-006 Pull orders, lines and deliveries (sync)
185. SYNC-007 Pull the ledger, money records and notifications (sync)
186. SYNC-008 Device tracking and full resynchronization (sync)
187. SYNC-009 Push endpoint, archive and envelope (sync)
188. SYNC-010 Judge pipeline: scope, field rights, computed fields (sync)
189. SYNC-011 Push new and edited customers, and merge duplicates (sync)
190. SYNC-012 Push orders entered offline (sync)
191. SYNC-013 Push order status changes and deliveries (sync)
192. SYNC-014 Push the closing of an order with its sale and payments (sync)
193. SYNC-015 Push payments and notification reads (sync)
194. SYNC-016 Controls on arrival: prices, articles and dates (sync)
195. SYNC-017 Controls on arrival: credit, restricted mode and long absence (sync)
196. SYNC-018 Forbidden sends are refused, recorded and trigger a resync (sync)
197. SYNC-019 First push after a rights change (sync)
198. SYNC-020 The list of things to resolve (sync)
199. SYNC-021 Owner reads the synchronization exceptions grouped by cause (sync)
200. SYNC-022 Super administrator replays an archived batch (sync)
201. SYNC-023 Administrators list and open archived batches (sync)
202. PRIV-001 Person checks whether they can delete their account (privacy)
203. PRIV-002 Person deletes their account by anonymization (privacy)
204. PRIV-003 Daily purge of expired data (privacy)

```mermaid
graph TD
  FND_000["FND-000"]
  FND_001["FND-001"]
  FND_002["FND-002"]
  FND_003["FND-003"]
  FND_004["FND-004"]
  FND_005["FND-005"]
  FND_006["FND-006"]
  FND_007["FND-007"]
  FND_008["FND-008"]
  FND_009["FND-009"]
  PER_001["PER-001"]
  PER_002["PER-002"]
  PER_003["PER-003"]
  PER_004["PER-004"]
  PER_005["PER-005"]
  PER_006["PER-006"]
  PER_007["PER-007"]
  PER_008["PER-008"]
  ACC_001["ACC-001"]
  ACC_002["ACC-002"]
  ACC_003["ACC-003"]
  ACC_004["ACC-004"]
  ACC_005["ACC-005"]
  ACC_006["ACC-006"]
  ACC_007["ACC-007"]
  NTF_001["NTF-001"]
  NTF_002["NTF-002"]
  NTF_003["NTF-003"]
  NTF_004["NTF-004"]
  AUTH_001["AUTH-001"]
  AUTH_002["AUTH-002"]
  AUTH_003["AUTH-003"]
  AUTH_004["AUTH-004"]
  AUTH_005["AUTH-005"]
  AUTH_006["AUTH-006"]
  AUTH_007["AUTH-007"]
  AUTH_008["AUTH-008"]
  AUTH_009["AUTH-009"]
  AUTH_010["AUTH-010"]
  AUTH_011["AUTH-011"]
  AUTH_012["AUTH-012"]
  AUTH_013["AUTH-013"]
  AUTH_014["AUTH-014"]
  AUTH_015["AUTH-015"]
  AUTH_016["AUTH-016"]
  AUTH_017["AUTH-017"]
  AUTH_018["AUTH-018"]
  AUTH_019["AUTH-019"]
  AUTH_020["AUTH-020"]
  AUTH_021["AUTH-021"]
  AUTH_022["AUTH-022"]
  AUTH_023["AUTH-023"]
  AUTH_024["AUTH-024"]
  AUTH_025["AUTH-025"]
  AUTH_026["AUTH-026"]
  ORG_001["ORG-001"]
  ORG_002["ORG-002"]
  ORG_003["ORG-003"]
  ORG_004["ORG-004"]
  ORG_005["ORG-005"]
  ORG_006["ORG-006"]
  ORG_007["ORG-007"]
  ORG_008["ORG-008"]
  ORG_009["ORG-009"]
  ORG_010["ORG-010"]
  ORG_011["ORG-011"]
  ORG_012["ORG-012"]
  ORG_013["ORG-013"]
  ORG_014["ORG-014"]
  ORG_015["ORG-015"]
  ORG_016["ORG-016"]
  ORG_017["ORG-017"]
  ORG_018["ORG-018"]
  ORG_019["ORG-019"]
  REL_001["REL-001"]
  REL_002["REL-002"]
  REL_003["REL-003"]
  REL_004["REL-004"]
  REL_005["REL-005"]
  REL_006["REL-006"]
  REL_007["REL-007"]
  REL_008["REL-008"]
  REL_009["REL-009"]
  REL_010["REL-010"]
  REL_011["REL-011"]
  REL_012["REL-012"]
  REL_013["REL-013"]
  REL_014["REL-014"]
  REL_015["REL-015"]
  REL_016["REL-016"]
  REL_017["REL-017"]
  REL_018["REL-018"]
  REL_019["REL-019"]
  REL_020["REL-020"]
  REL_021["REL-021"]
  REL_022["REL-022"]
  REL_023["REL-023"]
  REL_024["REL-024"]
  REL_025["REL-025"]
  ADM_001["ADM-001"]
  ADM_002["ADM-002"]
  ADM_003["ADM-003"]
  ADM_004["ADM-004"]
  ADM_005["ADM-005"]
  ADM_006["ADM-006"]
  ADM_007["ADM-007"]
  ADM_008["ADM-008"]
  ADM_009["ADM-009"]
  ADM_010["ADM-010"]
  ADM_011["ADM-011"]
  ADM_012["ADM-012"]
  ADM_013["ADM-013"]
  ADM_014["ADM-014"]
  ADM_015["ADM-015"]
  CAT_001["CAT-001"]
  CAT_002["CAT-002"]
  CAT_003["CAT-003"]
  CAT_004["CAT-004"]
  CAT_005["CAT-005"]
  CAT_006["CAT-006"]
  CAT_007["CAT-007"]
  CAT_008["CAT-008"]
  CAT_009["CAT-009"]
  CAT_010["CAT-010"]
  CAT_011["CAT-011"]
  ORD_001["ORD-001"]
  ORD_002["ORD-002"]
  ORD_003["ORD-003"]
  ORD_004["ORD-004"]
  ORD_005["ORD-005"]
  ORD_006["ORD-006"]
  ORD_007["ORD-007"]
  ORD_008["ORD-008"]
  ORD_009["ORD-009"]
  ORD_010["ORD-010"]
  ORD_011["ORD-011"]
  ORD_012["ORD-012"]
  ORD_013["ORD-013"]
  ORD_014["ORD-014"]
  ORD_015["ORD-015"]
  ORD_016["ORD-016"]
  ORD_017["ORD-017"]
  ORD_018["ORD-018"]
  ORD_019["ORD-019"]
  ORD_020["ORD-020"]
  ORD_021["ORD-021"]
  FIN_001["FIN-001"]
  FIN_002["FIN-002"]
  FIN_003["FIN-003"]
  FIN_004["FIN-004"]
  FIN_005["FIN-005"]
  FIN_006["FIN-006"]
  FIN_007["FIN-007"]
  FIN_008["FIN-008"]
  FIN_009["FIN-009"]
  FIN_010["FIN-010"]
  FIN_011["FIN-011"]
  FIN_012["FIN-012"]
  FIN_013["FIN-013"]
  FIN_014["FIN-014"]
  FIN_015["FIN-015"]
  FIN_016["FIN-016"]
  FIN_017["FIN-017"]
  FIN_018["FIN-018"]
  FIN_019["FIN-019"]
  FIN_020["FIN-020"]
  DLV_001["DLV-001"]
  DLV_002["DLV-002"]
  DLV_003["DLV-003"]
  DLV_004["DLV-004"]
  DLV_005["DLV-005"]
  DLV_006["DLV-006"]
  DLV_007["DLV-007"]
  DLV_008["DLV-008"]
  DLV_009["DLV-009"]
  DLV_010["DLV-010"]
  DLV_011["DLV-011"]
  DLV_012["DLV-012"]
  SYNC_001["SYNC-001"]
  SYNC_002["SYNC-002"]
  SYNC_003["SYNC-003"]
  SYNC_004["SYNC-004"]
  SYNC_005["SYNC-005"]
  SYNC_006["SYNC-006"]
  SYNC_007["SYNC-007"]
  SYNC_008["SYNC-008"]
  SYNC_009["SYNC-009"]
  SYNC_010["SYNC-010"]
  SYNC_011["SYNC-011"]
  SYNC_012["SYNC-012"]
  SYNC_013["SYNC-013"]
  SYNC_014["SYNC-014"]
  SYNC_015["SYNC-015"]
  SYNC_016["SYNC-016"]
  SYNC_017["SYNC-017"]
  SYNC_018["SYNC-018"]
  SYNC_019["SYNC-019"]
  SYNC_020["SYNC-020"]
  SYNC_021["SYNC-021"]
  SYNC_022["SYNC-022"]
  SYNC_023["SYNC-023"]
  PRIV_001["PRIV-001"]
  PRIV_002["PRIV-002"]
  PRIV_003["PRIV-003"]
  FND_000 --> FND_001
  FND_001 --> FND_002
  FND_000 --> FND_003
  FND_000 --> FND_004
  FND_001 --> FND_005
  FND_000 --> FND_006
  FND_000 --> FND_007
  FND_006 --> FND_008
  FND_006 --> FND_009
  FND_001 --> PER_001
  FND_006 --> PER_001
  PER_001 --> PER_002
  FND_002 --> PER_002
  FND_005 --> PER_002
  PER_002 --> PER_003
  PER_002 --> PER_004
  PER_002 --> PER_005
  FND_004 --> PER_005
  FND_005 --> PER_005
  PER_005 --> PER_006
  FND_006 --> PER_006
  PER_005 --> PER_007
  PER_003 --> PER_008
  FND_002 --> PER_008
  FND_000 --> ACC_001
  ACC_001 --> ACC_002
  ACC_002 --> ACC_003
  ACC_003 --> ACC_004
  ACC_004 --> ACC_005
  ACC_005 --> ACC_006
  FND_006 --> ACC_006
  ACC_006 --> ACC_007
  FND_005 --> ACC_007
  FND_002 --> ACC_007
  PER_002 --> ACC_007
  PER_008 --> NTF_001
  FND_005 --> NTF_001
  NTF_001 --> NTF_002
  FND_006 --> NTF_002
  NTF_002 --> NTF_003
  FND_009 --> NTF_003
  NTF_003 --> NTF_004
  PER_003 --> AUTH_001
  FND_005 --> AUTH_001
  AUTH_001 --> AUTH_002
  FND_004 --> AUTH_002
  FND_006 --> AUTH_002
  NTF_002 --> AUTH_002
  AUTH_002 --> AUTH_003
  AUTH_003 --> AUTH_004
  FND_000 --> AUTH_005
  PER_002 --> AUTH_006
  FND_006 --> AUTH_006
  PER_003 --> AUTH_007
  FND_005 --> AUTH_007
  AUTH_001 --> AUTH_007
  AUTH_007 --> AUTH_008
  AUTH_006 --> AUTH_008
  AUTH_005 --> AUTH_008
  AUTH_004 --> AUTH_009
  PER_005 --> AUTH_009
  NTF_002 --> AUTH_009
  AUTH_009 --> AUTH_010
  AUTH_008 --> AUTH_010
  AUTH_005 --> AUTH_010
  AUTH_010 --> AUTH_011
  NTF_002 --> AUTH_011
  AUTH_005 --> AUTH_012
  AUTH_012 --> AUTH_013
  AUTH_004 --> AUTH_013
  PER_005 --> AUTH_013
  AUTH_013 --> AUTH_014
  AUTH_008 --> AUTH_014
  NTF_002 --> AUTH_014
  AUTH_014 --> AUTH_015
  AUTH_011 --> AUTH_015
  AUTH_008 --> AUTH_016
  AUTH_016 --> AUTH_017
  AUTH_017 --> AUTH_018
  AUTH_013 --> AUTH_019
  AUTH_019 --> AUTH_020
  AUTH_008 --> AUTH_020
  AUTH_020 --> AUTH_021
  AUTH_004 --> AUTH_022
  PER_007 --> AUTH_022
  AUTH_022 --> AUTH_023
  AUTH_004 --> AUTH_024
  PER_005 --> AUTH_024
  AUTH_024 --> AUTH_025
  PER_004 --> AUTH_025
  AUTH_002 --> AUTH_026
  AUTH_005 --> AUTH_026
  PER_002 --> AUTH_026
  PER_002 --> ORG_001
  FND_002 --> ORG_001
  FND_005 --> ORG_001
  NTF_001 --> ORG_001
  ORG_001 --> ORG_002
  NTF_001 --> ORG_002
  ORG_001 --> ORG_003
  PER_008 --> ORG_003
  FND_005 --> ORG_003
  ORG_003 --> ORG_004
  ACC_007 --> ORG_004
  PER_005 --> ORG_004
  NTF_002 --> ORG_004
  ORG_004 --> ORG_005
  ACC_006 --> ORG_005
  ORG_003 --> ORG_006
  ORG_004 --> ORG_006
  ORG_005 --> ORG_007
  ACC_005 --> ORG_007
  ACC_007 --> ORG_007
  PER_005 --> ORG_007
  NTF_002 --> ORG_007
  ORG_007 --> ORG_008
  ORG_008 --> ORG_009
  ORG_008 --> ORG_010
  ORG_008 --> ORG_011
  ORG_001 --> ORG_012
  FND_005 --> ORG_012
  ORG_012 --> ORG_013
  ORG_005 --> ORG_013
  ACC_005 --> ORG_013
  ACC_007 --> ORG_013
  ORG_013 --> ORG_014
  ORG_008 --> ORG_015
  ACC_005 --> ORG_015
  ACC_007 --> ORG_015
  ORG_014 --> ORG_016
  ORG_010 --> ORG_016
  ACC_005 --> ORG_016
  ACC_007 --> ORG_016
  ORG_016 --> ORG_017
  ORG_011 --> ORG_018
  PER_006 --> ORG_018
  ORG_008 --> ORG_019
  ORG_001 --> REL_001
  PER_008 --> REL_001
  FND_005 --> REL_001
  ORG_003 --> REL_001
  REL_001 --> REL_002
  REL_001 --> REL_003
  FND_002 --> REL_003
  PER_008 --> REL_003
  PER_004 --> REL_003
  REL_002 --> REL_004
  REL_003 --> REL_004
  REL_002 --> REL_005
  ORG_005 --> REL_005
  REL_004 --> REL_006
  ORG_004 --> REL_006
  REL_006 --> REL_007
  REL_005 --> REL_007
  ACC_002 --> REL_007
  ACC_007 --> REL_007
  PER_005 --> REL_007
  NTF_002 --> REL_007
  REL_007 --> REL_008
  FND_009 --> REL_008
  REL_008 --> REL_009
  REL_009 --> REL_010
  ACC_002 --> REL_010
  REL_007 --> REL_011
  ACC_002 --> REL_011
  REL_008 --> REL_011
  REL_009 --> REL_012
  REL_004 --> REL_012
  ACC_002 --> REL_012
  ACC_007 --> REL_012
  NTF_002 --> REL_012
  REL_012 --> REL_013
  FND_009 --> REL_013
  REL_002 --> REL_014
  FND_002 --> REL_014
  PER_008 --> REL_014
  REL_003 --> REL_014
  REL_009 --> REL_015
  ACC_002 --> REL_015
  ACC_007 --> REL_015
  REL_005 --> REL_016
  FND_009 --> REL_016
  REL_006 --> REL_016
  REL_007 --> REL_016
  REL_008 --> REL_016
  REL_016 --> REL_017
  ACC_007 --> REL_017
  REL_006 --> REL_017
  REL_007 --> REL_017
  REL_008 --> REL_017
  REL_017 --> REL_018
  ACC_002 --> REL_018
  REL_006 --> REL_018
  REL_007 --> REL_018
  REL_008 --> REL_018
  REL_018 --> REL_019
  ACC_007 --> REL_019
  REL_006 --> REL_019
  REL_007 --> REL_019
  REL_008 --> REL_019
  REL_016 --> REL_020
  ORG_018 --> REL_020
  ACC_005 --> REL_020
  ACC_007 --> REL_020
  PER_006 --> REL_020
  REL_006 --> REL_020
  REL_007 --> REL_020
  REL_008 --> REL_020
  REL_020 --> REL_021
  REL_006 --> REL_021
  REL_007 --> REL_021
  REL_008 --> REL_021
  REL_021 --> REL_022
  ORG_008 --> REL_022
  REL_006 --> REL_022
  REL_007 --> REL_022
  REL_008 --> REL_022
  REL_014 --> REL_023
  REL_016 --> REL_023
  ACC_007 --> REL_023
  NTF_002 --> REL_023
  REL_006 --> REL_023
  REL_007 --> REL_023
  REL_008 --> REL_023
  REL_023 --> REL_024
  ACC_002 --> REL_024
  ACC_007 --> REL_024
  REL_006 --> REL_024
  REL_007 --> REL_024
  REL_008 --> REL_024
  REL_007 --> REL_025
  PER_008 --> ADM_001
  FND_005 --> ADM_001
  ORG_003 --> ADM_001
  ADM_001 --> ADM_002
  FND_002 --> ADM_002
  ORG_001 --> ADM_002
  REL_014 --> ADM_002
  ADM_002 --> ADM_003
  PER_008 --> ADM_003
  ADM_001 --> ADM_004
  ADM_004 --> ADM_005
  AUTH_005 --> ADM_005
  ADM_004 --> ADM_006
  ADM_002 --> ADM_006
  AUTH_012 --> ADM_006
  ORG_004 --> ADM_006
  ADM_006 --> ADM_007
  AUTH_004 --> ADM_007
  ADM_007 --> ADM_008
  NTF_002 --> ADM_008
  ADM_006 --> ADM_009
  ADM_005 --> ADM_009
  ADM_009 --> ADM_010
  ADM_003 --> ADM_011
  ACC_007 --> ADM_011
  ADM_006 --> ADM_011
  NTF_003 --> ADM_011
  ADM_011 --> ADM_012
  FND_009 --> ADM_012
  ADM_006 --> ADM_012
  ADM_012 --> ADM_013
  AUTH_008 --> ADM_013
  NTF_002 --> ADM_013
  ADM_006 --> ADM_013
  ADM_013 --> ADM_014
  ADM_006 --> ADM_014
  ADM_014 --> ADM_015
  FND_009 --> ADM_015
  ADM_006 --> ADM_015
  ORG_001 --> CAT_001
  FND_002 --> CAT_001
  FND_005 --> CAT_001
  CAT_001 --> CAT_002
  REL_002 --> CAT_002
  PER_008 --> CAT_002
  CAT_002 --> CAT_003
  REL_006 --> CAT_003
  CAT_001 --> CAT_004
  ORG_005 --> CAT_004
  ACC_002 --> CAT_004
  ACC_007 --> CAT_004
  CAT_003 --> CAT_004
  FND_003 --> CAT_004
  CAT_004 --> CAT_005
  CAT_003 --> CAT_005
  CAT_004 --> CAT_006
  FND_009 --> CAT_006
  CAT_003 --> CAT_006
  CAT_003 --> CAT_007
  CAT_006 --> CAT_007
  REL_005 --> CAT_007
  CAT_002 --> CAT_008
  CAT_006 --> CAT_008
  REL_009 --> CAT_008
  ACC_002 --> CAT_008
  ACC_007 --> CAT_008
  NTF_002 --> CAT_008
  CAT_003 --> CAT_008
  CAT_008 --> CAT_009
  FND_009 --> CAT_009
  CAT_003 --> CAT_009
  CAT_009 --> CAT_010
  ACC_007 --> CAT_010
  CAT_003 --> CAT_010
  CAT_004 --> CAT_011
  REL_016 --> CAT_011
  ACC_007 --> CAT_011
  CAT_003 --> CAT_011
  CAT_006 --> CAT_011
  REL_006 --> CAT_011
  REL_002 --> ORD_001
  PER_008 --> ORD_001
  FND_005 --> ORD_001
  ORD_001 --> ORD_002
  ORD_001 --> ORD_003
  ORG_001 --> ORD_003
  ORD_002 --> ORD_003
  ORD_001 --> ORD_004
  CAT_001 --> ORD_004
  PER_008 --> ORD_004
  FND_003 --> ORD_004
  ORD_002 --> ORD_004
  ORD_004 --> ORD_005
  ORD_003 --> ORD_005
  ORD_005 --> ORD_006
  ORD_004 --> ORD_007
  FND_003 --> ORD_007
  ORD_002 --> ORD_008
  ORD_007 --> ORD_008
  ORD_008 --> ORD_009
  ORD_005 --> ORD_009
  ORD_006 --> ORD_009
  REL_007 --> ORD_009
  CAT_003 --> ORD_009
  ACC_007 --> ORD_009
  NTF_002 --> ORD_009
  ORD_009 --> ORD_010
  ACC_005 --> ORD_010
  ORD_008 --> ORD_011
  ACC_003 --> ORD_011
  ACC_007 --> ORD_011
  NTF_002 --> ORD_011
  ORD_009 --> ORD_011
  ORD_008 --> ORD_012
  ACC_003 --> ORD_012
  ACC_007 --> ORD_012
  NTF_002 --> ORD_012
  ORD_009 --> ORD_012
  ORD_008 --> ORD_013
  ORD_005 --> ORD_013
  REL_009 --> ORD_013
  CAT_003 --> ORD_013
  ACC_003 --> ORD_013
  ACC_007 --> ORD_013
  ORD_009 --> ORD_013
  ORD_013 --> ORD_014
  ORD_009 --> ORD_014
  ORD_009 --> ORD_015
  ORD_008 --> ORD_016
  ACC_003 --> ORD_016
  ACC_007 --> ORD_016
  NTF_002 --> ORD_016
  ORD_009 --> ORD_016
  ORD_009 --> ORD_017
  ORD_010 --> ORD_017
  ORD_016 --> ORD_017
  ORD_008 --> ORD_018
  ORG_016 --> ORD_018
  ORD_013 --> ORD_019
  FND_009 --> ORD_019
  ORD_009 --> ORD_019
  ORD_019 --> ORD_020
  ORD_009 --> ORD_020
  ORD_017 --> ORD_021
  ORD_019 --> ORD_021
  FND_009 --> ORD_021
  REL_001 --> FIN_001
  ORD_001 --> FIN_001
  PER_008 --> FIN_001
  FND_002 --> FIN_001
  REL_014 --> FIN_001
  FIN_001 --> FIN_002
  ORD_006 --> FIN_002
  ORD_003 --> FIN_002
  FIN_002 --> FIN_003
  REL_025 --> FIN_003
  ORG_006 --> FIN_003
  FIN_003 --> FIN_004
  REL_009 --> FIN_004
  ACC_004 --> FIN_004
  ACC_007 --> FIN_004
  FIN_004 --> FIN_005
  ACC_004 --> FIN_005
  NTF_002 --> FIN_005
  FIN_005 --> FIN_006
  FIN_005 --> FIN_007
  FIN_005 --> FIN_008
  FIN_006 --> FIN_008
  FIN_005 --> FIN_009
  ACC_007 --> FIN_009
  FIN_009 --> FIN_010
  FND_009 --> FIN_010
  ORG_003 --> FIN_011
  PER_008 --> FIN_011
  FND_002 --> FIN_011
  FIN_011 --> FIN_012
  FIN_003 --> FIN_012
  ACC_004 --> FIN_012
  ACC_007 --> FIN_012
  FIN_004 --> FIN_012
  FIN_012 --> FIN_013
  FIN_004 --> FIN_013
  FIN_011 --> FIN_014
  FIN_014 --> FIN_015
  FIN_012 --> FIN_015
  NTF_002 --> FIN_015
  FIN_004 --> FIN_015
  FIN_015 --> FIN_016
  FIN_004 --> FIN_016
  FIN_015 --> FIN_017
  ORG_015 --> FIN_017
  FIN_016 --> FIN_018
  FIN_003 --> FIN_018
  FIN_016 --> FIN_019
  ORD_013 --> FIN_019
  FIN_004 --> FIN_019
  FIN_010 --> FIN_019
  FIN_019 --> FIN_020
  FND_009 --> FIN_020
  FIN_004 --> FIN_020
  FIN_010 --> FIN_020
  ORD_001 --> DLV_001
  PER_008 --> DLV_001
  FND_002 --> DLV_001
  DLV_001 --> DLV_002
  ORG_003 --> DLV_002
  ORD_003 --> DLV_002
  DLV_002 --> DLV_003
  REL_005 --> DLV_003
  ORD_007 --> DLV_003
  DLV_003 --> DLV_004
  ACC_003 --> DLV_004
  ACC_007 --> DLV_004
  NTF_002 --> DLV_004
  DLV_004 --> DLV_005
  ORD_008 --> DLV_005
  DLV_005 --> DLV_006
  DLV_005 --> DLV_007
  FIN_004 --> DLV_007
  ACC_003 --> DLV_007
  ACC_007 --> DLV_007
  NTF_002 --> DLV_007
  DLV_007 --> DLV_008
  DLV_007 --> DLV_009
  ORD_013 --> DLV_009
  REL_011 --> DLV_009
  ORD_009 --> DLV_009
  DLV_007 --> DLV_010
  ORD_017 --> DLV_010
  DLV_008 --> DLV_011
  FIN_019 --> DLV_011
  DLV_008 --> DLV_012
  FIN_019 --> DLV_012
  ORG_005 --> SYNC_001
  AUTH_006 --> SYNC_001
  ACC_001 --> SYNC_001
  AUTH_007 --> SYNC_002
  ADM_002 --> SYNC_002
  FND_002 --> SYNC_002
  SYNC_001 --> SYNC_003
  FND_008 --> SYNC_003
  SYNC_003 --> SYNC_004
  REL_005 --> SYNC_004
  CAT_002 --> SYNC_004
  SYNC_004 --> SYNC_005
  CAT_001 --> SYNC_005
  CAT_003 --> SYNC_005
  SYNC_005 --> SYNC_006
  ORD_007 --> SYNC_006
  DLV_001 --> SYNC_006
  SYNC_006 --> SYNC_007
  FIN_001 --> SYNC_007
  FIN_014 --> SYNC_007
  REL_003 --> SYNC_007
  NTF_001 --> SYNC_007
  FIN_003 --> SYNC_007
  SYNC_003 --> SYNC_008
  AUTH_007 --> SYNC_008
  PER_005 --> SYNC_008
  SYNC_008 --> SYNC_009
  SYNC_002 --> SYNC_009
  SYNC_006 --> SYNC_009
  SYNC_009 --> SYNC_010
  ACC_002 --> SYNC_010
  SYNC_010 --> SYNC_011
  REL_025 --> SYNC_011
  REL_007 --> SYNC_011
  SYNC_004 --> SYNC_011
  SYNC_011 --> SYNC_012
  ORD_013 --> SYNC_012
  SYNC_012 --> SYNC_013
  ORD_008 --> SYNC_013
  DLV_005 --> SYNC_013
  DLV_006 --> SYNC_013
  SYNC_013 --> SYNC_014
  DLV_008 --> SYNC_014
  SYNC_014 --> SYNC_015
  FIN_004 --> SYNC_015
  NTF_004 --> SYNC_015
  SYNC_012 --> SYNC_016
  NTF_002 --> SYNC_016
  SYNC_016 --> SYNC_017
  SYNC_014 --> SYNC_017
  SYNC_010 --> SYNC_018
  NTF_002 --> SYNC_018
  SYNC_018 --> SYNC_019
  SYNC_014 --> SYNC_019
  SYNC_017 --> SYNC_020
  FND_009 --> SYNC_020
  SYNC_006 --> SYNC_020
  SYNC_020 --> SYNC_021
  SYNC_006 --> SYNC_021
  SYNC_018 --> SYNC_022
  ADM_009 --> SYNC_022
  ADM_002 --> SYNC_022
  SYNC_006 --> SYNC_022
  SYNC_022 --> SYNC_023
  FND_009 --> SYNC_023
  SYNC_006 --> SYNC_023
  ORG_005 --> PRIV_001
  REL_016 --> PRIV_001
  PRIV_001 --> PRIV_002
  AUTH_008 --> PRIV_002
  AUTH_005 --> PRIV_002
  SYNC_002 --> PRIV_003
  AUTH_007 --> PRIV_003
  ACC_007 --> PRIV_003
  NTF_001 --> PRIV_003
  FND_002 --> PRIV_003
  FIN_018 --> PRIV_003
```
