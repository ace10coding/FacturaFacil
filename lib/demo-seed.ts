import { randomBytes, scryptSync } from "node:crypto";
import { addDaysIso, db, nowIso, todayIso, uid } from "./db";
import { computeTotals, formatMoney } from "./money";
import { allocateQuotationNumber, buildSnapshot, type CustomerRow, type ItemRow, type QuotationRow } from "./quotations";
import type { Business } from "./auth";
import { DEMO_EMAIL } from "./demo";

export const DEMO_PASSWORD = "demo1234";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

function seedDemoDataInDatabase(database: ReturnType<typeof db>): void {
  const existing = database.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_EMAIL) as
    | { id: string }
    | undefined;
  const existingBusiness = existing
    ? database.prepare("SELECT id FROM businesses WHERE owner_user_id = ?").get(existing.id)
    : undefined;
  if (existingBusiness) {
    console.log(`Seed ignorado: ${DEMO_EMAIL} já existe.`);
    return;
  }

  const now = nowIso();
  const userId = existing?.id ?? uid();
  const businessId = uid();

  if (!existing) {
    database
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, DEMO_EMAIL, hashPassword(DEMO_PASSWORD), now);
  }
  database
    .prepare("INSERT OR IGNORE INTO profiles (id, user_id, full_name, created_at) VALUES (?, ?, ?, ?)")
    .run(uid(), userId, "Ndalu Machava", now);
  database
    .prepare(
      `INSERT INTO businesses (id, owner_user_id, name, nuit, email, phone, whatsapp, address, city, province, website,
        default_validity_days, default_notes, default_terms, default_tax_bp, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 30, ?, ?, 1600, 'MZN', ?, ?)`,
    )
    .run(
      businessId,
      userId,
      "Ateliê Ndalu",
      "400123456",
      "geral@ateliendalu.co.mz",
      "+258 84 555 0100",
      "84 555 0100",
      "Av. Julius Nyerere, 141",
      "Maputo",
      "Maputo Cidade",
      "www.ateliendalu.co.mz",
      "Preços válidos por 30 dias a partir da data de emissão.",
      "50% na adjudicação, restante na entrega. Deslocações fora de Maputo são orçamentadas à parte.",
      now,
      now,
    );

  const business = database.prepare("SELECT * FROM businesses WHERE id = ?").get(businessId) as unknown as Business;

  function insertCustomer(name: string, company: string | null, phone: string, email: string | null, city: string): CustomerRow {
    const id = uid();
    database
      .prepare(
        `INSERT INTO customers (id, business_id, name, company_name, phone, whatsapp, email, city, address, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, businessId, name, company, phone, phone, email, city, city === "Maputo" ? "Av. 24 de Julho, 88" : null, now, now);
    return database.prepare("SELECT * FROM customers WHERE id = ?").get(id) as unknown as CustomerRow;
  }

  const kubanza = insertCustomer("Construções Kubanza", "Kubanza Lda", "84 111 2233", "obras@kubanza.co.mz", "Maputo");
  const maria = insertCustomer("Maria Silva", null, "87 444 5566", "maria.silva@email.co.mz", "Matola");
  const hotel = insertCustomer("Hotel Costa do Sol", "Costa do Sol SA", "21 455 0011", "compras@costadosol.co.mz", "Maputo");

  function insertCatalog(name: string, type: "produto" | "servico", unit: string, priceCents: number, description: string, category: string) {
    database
      .prepare(
        `INSERT INTO catalog_items (id, business_id, name, description, type, unit, price_cents, category, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(uid(), businessId, name, description, type, unit, priceCents, category, now, now);
  }

  insertCatalog("Design de logótipo", "servico", "unidade", 850000, "Criação de identidade visual e ficheiros finais", "Design");
  insertCatalog("Gestão de redes sociais", "servico", "mês", 1200000, "Planeamento e 12 publicações mensais", "Marketing");
  insertCatalog("Impressão de flyers A5", "produto", "unidade", 3500, "Papel couché 150g, impressão frente e verso", "Impressão");
  insertCatalog("Consultoria de negócio", "servico", "hora", 450000, "Sessão de aconselhamento estratégico", "Consultoria");
  insertCatalog("Instalação elétrica", "servico", "dia", 750000, "Mão de obra e material básico incluído", "Obras");

  type SeedLine = {
    description: string;
    quantityMilli: number;
    unit: string;
    unitPriceCents: number;
    discountBp: number;
    taxRateBp: number;
  };

  const issuedRows: { quotation: QuotationRow; lines: SeedLine[] }[] = [];

  function insertQuotation(params: {
    customer: CustomerRow;
    title: string;
    issueDate: string;
    validUntil: string;
    status: "rascunho" | "enviada" | "aceite";
    lines: SeedLine[];
    quoteDiscountCents?: number;
    issued: boolean;
    notes: string;
    terms: string;
  }) {
    const id = uid();
    const totals = computeTotals(
      params.lines.map(({ quantityMilli, unitPriceCents, discountBp, taxRateBp }) => ({
        quantityMilli,
        unitPriceCents,
        discountBp,
        taxRateBp,
      })),
      params.quoteDiscountCents ?? 0,
    );

    database
      .prepare(
        `INSERT INTO quotations (id, business_id, customer_id, quotation_number, title, issue_date, valid_until, status,
          subtotal_cents, discount_cents, quote_discount_cents, tax_cents, total_cents, notes, terms, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 'rascunho', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        businessId,
        params.customer.id,
        params.title,
        params.issueDate,
        params.validUntil,
        totals.subtotalCents,
        totals.discountCents,
        params.quoteDiscountCents ?? 0,
        totals.taxCents,
        totals.totalCents,
        params.notes,
        params.terms,
        `${params.issueDate}T09:00:00.000Z`,
        `${params.issueDate}T09:00:00.000Z`,
      );

    const insertItem = database.prepare(
      `INSERT INTO quotation_items (id, quotation_id, business_id, catalog_item_id, description, quantity_milli, unit,
        unit_price_cents, discount_bp, tax_rate_bp, line_total_cents, sort_order)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    params.lines.forEach((line, index) => {
      insertItem.run(
        uid(),
        id,
        businessId,
        line.description,
        line.quantityMilli,
        line.unit,
        line.unitPriceCents,
        line.discountBp,
        line.taxRateBp,
        totals.lines[index].netCents,
        index,
      );
    });

    if (params.issued) {
      const number = allocateQuotationNumber(businessId, Number(params.issueDate.slice(0, 4)));
      database.prepare("UPDATE quotations SET quotation_number = ?, status = ? WHERE id = ?").run(number, params.status, id);
      const quotation = database.prepare("SELECT * FROM quotations WHERE id = ?").get(id) as unknown as QuotationRow;
      const items = database
        .prepare("SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order")
        .all(id) as unknown as ItemRow[];
      const snapshot = buildSnapshot(business, params.customer, quotation, items, number);
      database
        .prepare("UPDATE quotations SET issued_snapshot = ?, issued_at = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(snapshot), `${params.issueDate}T09:30:00.000Z`, now, id);
      issuedRows.push({ quotation, lines: params.lines });
    }
  }

  const today = todayIso();

  insertQuotation({
    customer: kubanza,
    title: "Identidade visual para novo escritório",
    issueDate: addDaysIso(today, -12),
    validUntil: addDaysIso(today, 18),
    status: "aceite",
    notes: "Inclui duas rondas de revisão.",
    terms: "50% na adjudicação, restante na entrega dos ficheiros finais.",
    issued: true,
    lines: [
      { description: "Design de logótipo e manual de marca", quantityMilli: 1000, unit: "unidade", unitPriceCents: 850000, discountBp: 0, taxRateBp: 1600 },
      { description: "Impressão de flyers A5 (500 un.)", quantityMilli: 500000, unit: "unidade", unitPriceCents: 3500, discountBp: 500, taxRateBp: 1600 },
    ],
  });

  insertQuotation({
    customer: hotel,
    title: "Gestão de redes sociais, trimestre",
    issueDate: addDaysIso(today, -3),
    validUntil: addDaysIso(today, 27),
    status: "enviada",
    notes: "Relatório mensal de desempenho incluído.",
    terms: "Pagamento até ao dia 5 de cada mês.",
    issued: true,
    lines: [
      { description: "Gestão de redes sociais", quantityMilli: 3000, unit: "mês", unitPriceCents: 1200000, discountBp: 1000, taxRateBp: 1600 },
      { description: "Consultoria de negócio", quantityMilli: 4000, unit: "hora", unitPriceCents: 450000, discountBp: 0, taxRateBp: 1600 },
    ],
    quoteDiscountCents: 150000,
  });

  insertQuotation({
    customer: maria,
    title: "Decoração de sala de estar",
    issueDate: today,
    validUntil: addDaysIso(today, 30),
    status: "rascunho",
    notes: "Aguardar confirmação das medidas.",
    terms: "50% na adjudicação, restante na entrega.",
    issued: false,
    lines: [
      { description: "Instalação elétrica e iluminação", quantityMilli: 2000, unit: "dia", unitPriceCents: 750000, discountBp: 0, taxRateBp: 1600 },
    ],
  });

  console.log("Seed concluído.");
  console.log(`Negócio: ${business.name}`);
  issuedRows.forEach(({ quotation }) => console.log(`Cotação emitida: ${quotation.quotation_number} · ${formatMoney(quotation.total_cents)} MT`));
}

export function seedDemoData(): void {
  const database = db();
  const ready = database
    .prepare(
      `SELECT b.id FROM users u JOIN businesses b ON b.owner_user_id = u.id
       WHERE u.email = ?`,
    )
    .get(DEMO_EMAIL);
  if (ready) return;

  seedDemoDataInDatabase(database);
}
