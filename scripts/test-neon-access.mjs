import { connectNeon } from "./neon-db.mjs";
import { randomUUID } from "node:crypto";
const db = await connectNeon();
const id = randomUUID();
try {
  await db.query("BEGIN");
  await db.query(
    "UPDATE magalhaes_private.bootstrap_admin SET email='admin-validation@example.invalid'",
  );
  await db.query(
    'insert into neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,true,now(),now())',
    [id, "Administrador de validação", "admin-validation@example.invalid"],
  );
  const role = await db.query(
    "select r.role,m.role membership from public.user_roles r join public.workspace_memberships m on m.user_id=r.user_id where r.user_id=$1",
    [id],
  );
  if (role.rows[0]?.role !== "admin" || role.rows[0]?.membership !== "admin")
    throw Error("Administrador inicial não recebeu os acessos esperados");
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("SET LOCAL ROLE authenticated");
  const who = await db.query("select public.neon_uid() id");
  if (who.rows[0].id !== id) throw Error("Identidade não aplicada");
  const client = await db.query(
    "insert into public.clients(name,created_by) values('Cliente descartável de validação',$1) returning id",
    [id],
  );
  const task = await db.query(
    "insert into public.tasks(title,client_id,created_by) values('Tarefa descartável de validação',$1,$2) returning id",
    [client.rows[0].id, id],
  );
  await db.query("insert into public.subtasks(task_id,title) values($1,'Etapa descartável')", [
    task.rows[0].id,
  ]);
  await db.query(
    "select public.neon_file_upload('task-attachments','validation/private.txt','dmFsaWRhY2Fv','text/plain',false)",
  );
  const file = await db.query(
    "select public.neon_file_download('task-attachments','validation/private.txt') data",
  );
  if (!file.rows[0].data?.content) throw Error("Anexo privado não recuperado");
  await db.query(
    "select public.neon_admin_access('create',jsonb_build_object('email','validation-invite@example.invalid','role','collaborator','permissions',jsonb_build_array('tasks')))",
  );
  await db.query("RESET ROLE");
  const collaborator = randomUUID();
  await db.query(
    'insert into neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,true,now(),now())',
    [collaborator, "Colaborador descartável", "validation-invite@example.invalid"],
  );
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.query("SET LOCAL ROLE authenticated");
  await db.query("select public.neon_admin_access('update',$1::jsonb)", [
    JSON.stringify({
      userId: collaborator,
      role: "collaborator",
      fullName: "Colaborador validado",
      permissions: ["tasks"],
    }),
  ]);
  await db.query("RESET ROLE");
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: collaborator, role: "authenticated" }),
  ]);
  await db.query("SET LOCAL ROLE authenticated");
  await db.query("SAVEPOINT admin_denied");
  let adminDenied = false;
  try {
    await db.query(
      "select public.neon_admin_access('create',jsonb_build_object('email','another@example.invalid'))",
    );
  } catch {
    adminDenied = true;
    await db.query("ROLLBACK TO SAVEPOINT admin_denied");
  }
  if (!adminDenied) throw Error("Colaborador conseguiu gerenciar acessos");
  await db.query("RESET ROLE");
  await db.query("update public.profiles set is_active=false where id=$1", [collaborator]);
  await db.query("SET LOCAL ROLE authenticated");
  if ((await db.query("select count(*) n from public.clients")).rows[0].n !== "0")
    throw Error("Conta desativada acessou clientes");
  await db.query("RESET ROLE");
  await db.query("SAVEPOINT unauthorized");
  let denied = false;
  try {
    await db.query(
      'insert into neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,true,now(),now())',
      [randomUUID(), "Sem convite", "validation-denied@example.invalid"],
    );
  } catch {
    denied = true;
    await db.query("ROLLBACK TO SAVEPOINT unauthorized");
  }
  if (!denied) throw Error("Cadastro sem convite não foi bloqueado");
  console.log(
    "PASS: único administrador inicial, identidade JWT, cliente, tarefa, subtarefa, anexo privado e convite. Cadastro sem convite bloqueado.",
  );
} catch (error) {
  console.error(error.message, error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
