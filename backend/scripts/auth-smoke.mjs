import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { StringDecoder } from "node:string_decoder";
import { createClient } from "@supabase/supabase-js";
import { hasPermission } from "../dist/middleware/authorization.js";

function ask(prompt) {
  const terminal = createInterface({ input: stdin, output: stdout });
  return terminal.question(prompt).finally(() => terminal.close());
}

async function checkState(label, token, expectedStatus, expectedRole, expectedUserId) {
  stdout.write(`\n${label}\n`);
  let profile = null;
  for (const path of ["/api/auth/me", "/api/auth/check"]) {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    stdout.write(`${path}: HTTP ${response.status}\n`);
    if (response.status !== expectedStatus) process.exitCode = 1;
    if (path === "/api/auth/me" && response.status === 200) {
      profile = body;
      stdout.write(`rol=${body.rol?.codigo ?? "?"}; permisos=${JSON.stringify(body.permisos ?? [])}\n`);
      if (expectedRole && body.rol?.codigo !== expectedRole) process.exitCode = 1;
      if (expectedUserId && body.id !== expectedUserId) process.exitCode = 1;
      if (body.rol && Array.isArray(body.permisos)) {
        const expectedPermissions = body.rol.codigo === "ADMINISTRACION" ? ["auditoria.consultar"] : [];
        const actualPermissions = [...body.permisos].sort();
        if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
          stdout.write("permisos coinciden con la matriz esperada=false\n");
          process.exitCode = 1;
        } else {
          stdout.write("permisos coinciden con la matriz esperada=true\n");
        }
        const auditAllowed = hasPermission(
          { id: "", nombre: "", rol: body.rol, permisos: body.permisos },
          "auditoria.consultar",
        );
        stdout.write(`auditoria.consultar permitido=${auditAllowed}\n`);
        if (auditAllowed !== (body.rol.codigo === "ADMINISTRACION")) process.exitCode = 1;
      }
    }
  }

  const forgedHeadersResponse = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}/api/auth/me`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-user-id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "x-user-role": "ADMINISTRACION",
      "x-actor-id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "x-actor-type": "usuario",
    },
  });
  const forgedHeadersBody = await forgedHeadersResponse.json().catch(() => ({}));
  const spoofIgnored = forgedHeadersResponse.status === expectedStatus &&
    (expectedStatus !== 200 || (
      forgedHeadersBody.id === expectedUserId &&
      forgedHeadersBody.rol?.codigo === expectedRole &&
      JSON.stringify([...(forgedHeadersBody.permisos ?? [])].sort()) ===
        JSON.stringify([...(profile?.permisos ?? [])].sort())
    ));
  stdout.write(`headers de identidad falsificados: HTTP ${forgedHeadersResponse.status}; ignorados=${spoofIgnored}\n`);
  if (!spoofIgnored) process.exitCode = 1;

  return profile;
}

async function waitForStateChange(message) {
  await ask(`\n${message}\nPresiona Enter después de confirmar el COMMIT: `);
}

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Ejecuta este comando desde una terminal interactiva para ocultar la contraseña.");
  }

  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw;
    const decoder = new StringDecoder("utf8");
    let password = "";
    let finished = false;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();

    const finish = (error) => {
      if (finished) return;
      finished = true;
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    };

    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") {
          finish(new Error("Prueba cancelada."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
          continue;
        }
        if (character >= " ") password += character;
      }
    };

    stdin.on("data", onData);
  });
}

async function main() {
  if (!process.argv.includes("--development")) {
    throw new Error("Se requiere --development. Confirma antes que .env apunta al proyecto de desarrollo.");
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Falta SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY en backend/.env.");
  }

  const expectedUserIdIndex = process.argv.indexOf("--expected-user-id");
  const expectedUserId = expectedUserIdIndex >= 0 ? process.argv[expectedUserIdIndex + 1] : undefined;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (process.argv.includes("--sequence") && (!expectedUserId || !uuidPattern.test(expectedUserId))) {
    throw new Error("La secuencia requiere --expected-user-id con la UUID de la única cuenta de prueba.");
  }

  const email = (await ask("Correo de la cuenta de prueba: ")).trim();
  const password = await readHidden("Contraseña (entrada oculta): ");
  if (!email || !password) throw new Error("Se requiere una cuenta de prueba.");

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw new Error("Supabase Auth no aceptó la cuenta de prueba.");
  }
  if (expectedUserId && data.user?.id !== expectedUserId) {
    throw new Error("La identidad autenticada no coincide con la UUID de prueba; no se ejecutaron solicitudes al backend.");
  }
  if (expectedUserId) stdout.write("La identidad Auth coincide con la UUID de prueba.\n");

  const token = data.session.access_token;
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT no es válido.");
  }

  if (process.argv.includes("--sequence")) {
    await checkState("1. Identidad Auth sin perfil; se espera 403", token, 403, undefined, expectedUserId);
    await waitForStateChange("Inserta el perfil inactivo mediante la transacción auditada del runbook.");
    await checkState("2. Perfil inactivo; se espera 403", token, 403, undefined, expectedUserId);
    await waitForStateChange("Activa el perfil con rol ADMINISTRACION mediante una transacción auditada.");
    await checkState("3. Administración activa; se espera 200", token, 200, "ADMINISTRACION", expectedUserId);
    await waitForStateChange("Cambia el perfil a VENTAS mediante una transacción auditada.");
    await checkState("4. Ventas activa; se espera 200", token, 200, "VENTAS", expectedUserId);
    await waitForStateChange("Cambia el perfil a LOGISTICA mediante una transacción auditada.");
    await checkState("5. Logística activa; se espera 200", token, 200, "LOGISTICA", expectedUserId);
  } else {
    await checkState("Autenticación de la cuenta", token, 200, undefined, expectedUserId);
  }

  const forgedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/check`, {
    headers: { authorization: "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImZha2UifQ.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjQxMDI0NDQ4MDB9.invalid" },
  });
  stdout.write(`\nToken falsificado: HTTP ${forgedResponse.status}\n`);
  if (forgedResponse.status !== 401) process.exitCode = 1;
}

main().catch((error) => {
  stdout.write(`${error instanceof Error ? error.message : "Falló la prueba de integración."}\n`);
  process.exitCode = 1;
});
