# Recettes d'extraction ciblée

Ne charger qu'une rubrique : `grep -n '^##' extraction.md` puis `sed -n '<début>,<fin>p'`.
Démarche : localiser (`grep -l`, `grep -c`) → cibler (`grep -n`, puis `sed -n 'a,bp'` autour des lignes trouvées) → s'arrêter dès que l'info suffit.
Toujours sur les fichiers listés par `scan` (ou un chemin précis), avec `| head -40`. Jamais `.env`, clés ou secrets (`.env.example` seulement).
`f` = fichier ciblé ; `D` = dossier source.

## a. Specs et décisions
- OpenAPI / Swagger / AsyncAPI / Postman / GraphQL : `python3 "$S/scripts/spec_digest.py" f`, filtré :
  - Meta + auth : `| grep -E '^(META|SERVER|SEC)'` ; endpoints : `| grep '^EP'` ; sync : `| grep -iE '^EP .*(sync|pull|push|changes|since)'`
  - un schéma : `| grep -E '^(S|F) Order[ .]'` ; enums : `| grep 'enum('` ; uploads : `| grep -E 'multipart|binary'` ; temps réel : `| grep -E '^(CH|OP|MSG)'`
  - `--desc` seulement sur un schéma précis quand une règle métier peut s'y cacher : `spec_digest.py f --desc | grep '^F Order\.'`.
  - Lecture : `in=p:id!=string(uuid) q:limit=integer[max=100] h:Idempotency-Key!=string` ; `body=OrderCreate(json)!` ; `ok=201:Order` ; `rh=ETag,Location` ; `err=409,422,429[Retry-After]:Problem(problem)`.
- ADR : `grep -nE '^#|^#+ *(Status|Statut|Decision|Décision)' -A4 f` (titre, statut, décision ; ignorer contexte et alternatives).
- Protobuf : `grep -nE '^\s*(service|rpc|message|enum)\b|^\s+(repeated |optional )?\w+ \w+ = [0-9]+' f`.
- Diagrammes (`.mmd`, `.puml`, `.dbml`) : `grep -nE 'erDiagram|entity|class |Table |Ref:|\|\||\}o|o\{' f`.

## b. Schémas DB, migrations, DTO, modèles
- SQL : `grep -nEi 'create table|alter table|add column|drop (column|table)|rename|references|unique|check|not null|default' f`
- Prisma : `sed -n '/^model Order /,/^}/p' schema.prisma` ; enums : `grep -nA8 '^enum ' schema.prisma`
- TypeORM / MikroORM : `grep -nE -A1 '@(Entity|Column|PrimaryGeneratedColumn|PrimaryColumn|ManyToOne|OneToMany|ManyToMany|JoinColumn|Index|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn)' f`
- Sequelize : `grep -nE 'define\(|DataTypes\.|allowNull|references|paranoid|validate' f` ; Mongoose : `grep -nE 'new Schema|type:|required:|enum:|ref:|default:|timestamps' f`
- DTO NestJS (class-validator) : `grep -nE '@(Is\w+|Min|Max|Length|MinLength|MaxLength|Matches|ArrayMaxSize|IsOptional|ValidateNested)\(|^\s+\w+[?!]?:' f`
- Zod / Joi / Yup : `grep -nE 'z\.|Joi\.|yup\.' f`
- Django : `grep -nE 'class \w+\(.*Model\)|models\.\w+\(|ForeignKey|choices=|max_length|null=True|unique' f` ; DRF : `grep -nE 'class \w+\(.*Serializer\)|fields =|read_only|extra_kwargs' f`
- SQLAlchemy / SQLModel / Pydantic : `grep -nE 'Column\(|mapped_column|relationship\(|ForeignKey|class \w+\((BaseModel|SQLModel)|Field\(|Optional\[|Literal\[' f`
- Rails : `grep -nE 'create_table|t\.\w+|add_column|add_reference|add_index' db/schema.rb` ; modèles : `grep -nE 'validates|belongs_to|has_many|enum ' f`
- Laravel : migrations `grep -nE '\$table->' f` ; modèles `grep -nE '\$(fillable|casts|hidden)|(hasMany|belongsTo)\(' f` ; FormRequest `grep -nE "'\w+' => " f`
- JPA / Spring : `grep -nE '@(Entity|Table|Column|Id|GeneratedValue|ManyToOne|OneToMany|JoinColumn|Enumerated|Version|NotNull|NotBlank|Size|Min|Max|Pattern|Email)' f`
- EF Core : `grep -nE '\[(Key|Required|MaxLength|StringLength|Range|ForeignKey|Timestamp|ConcurrencyCheck)|public [A-Za-z<>?]+ \w+ \{ get' f`
- Go (gorm, validator) : `grep -nE 'gorm:"|json:"|validate:"|binding:"' f`
- Signaux §4 : `@Version`, `VersionColumn`, `[Timestamp]`, `row_version` → verrouillage optimiste (ETag/If-Match) ; `deleted_at`, `paranoid`, `SoftDeletes` → soft-delete ; `updated_at` indexé → pull incrémental possible.

## c. Routes, auth, erreurs
- NestJS : `grep -rnE "@(Controller|Get|Post|Put|Patch|Delete)\(|@(UseGuards|Roles|Public)\(" D --include=*.controller.ts`
- Express / Fastify / Koa / Hono : `grep -rnE "\b(router|app|fastify|server|r)\.(get|post|put|patch|delete|route)\(" D --include=*.ts --include=*.js`
- FastAPI / Flask : `grep -rnE "@\w+\.(get|post|put|patch|delete|route)\(|APIRouter\(|include_router" D --include=*.py`
- Django / DRF : `grep -rnE "path\(|re_path\(|router\.register|@action\(|permission_classes" D --include=urls.py --include=views.py`
- Spring : `grep -rnE "@(RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|PreAuthorize)" D`
- Laravel : `grep -nE "Route::|->middleware\(" routes/api.php` ; Rails : `grep -nE "^\s*(resources?|get|post|put|patch|delete|namespace|scope)\b" config/routes.rb`
- Go : `grep -rnE "\.(GET|POST|PUT|PATCH|DELETE|Handle|HandleFunc|Group|Route)\(" D --include=*.go`
- ASP.NET : `grep -rnE "\[(Http(Get|Post|Put|Patch|Delete)|Route|Authorize|AllowAnonymous)|Map(Get|Post|Put|Patch|Delete)\(" D --include=*.cs`
- Auth / session : `grep -niE "expires_?in|ttl|access_?token|refresh_?token|rotat|revoke|logout|pkce|scope|bearer" f | head -40`
- Durées hors code : `grep -rniE "expir|ttl|lifetime" D --include=application*.yml --include=application*.properties --include=appsettings*.json --include=*.env.example | head`
- Rôles : `grep -rnE "@Roles\(|hasRole|hasAuthority|@PreAuthorize|permission_classes|Gate::|->can\(|authorize\(" D | head -40`
- Erreurs : `grep -rnE "problem\+json|ProblemDetail|HttpException|HTTPException|ResponseStatusException|status\((4|5)[0-9]{2}\)|abort\((4|5)|error_?code" D | head -40`
- Quotas : `grep -rniE "throttl|rate.?limit|Retry-After|429" D | head` ; concurrence / idempotence : `grep -rniE "idempotency|If-Match|ETag|If-None-Match|optimistic" D | head`
- Sync : `grep -rniE "last_?pulled_?at|updated_?since|modified_?since|deleted_?at|tombstone|soft.?delete|last_?modified" D | head`
- Temps réel : `grep -rniE "fcm|firebase-admin|apns|expo-server-sdk|socket\.io|websocket|EventSource|text/event-stream|pusher|ably|mqtt" D | head`
- Uploads : `grep -rniE "multer|multipart|upload|presign|putObject|max_?file_?size|fileSize|tus" D | head`

## d. User stories
- Inventaire sans lecture : `grep -m1 -nE '^# ' D/*.md` (titre de chaque story) → ne lire que les stories utiles.
- Markdown : titres `grep -nE '^#{1,3} ' f` + critères `sed -n '/[Cc]rit[eè]res\|[Aa]cceptance/,/^#/p' f` ; ignorer contexte, maquettes, notes.
- Gherkin : `grep -nE '^\s*(Feature|Fonctionnalité|Scenario|Scénario|Given|When|Then|And|But|Étant donné|Quand|Alors|Et|Mais)\b' f`
- Story modifiée en repo git : `diff_sources.py diff f` suffit en général.
