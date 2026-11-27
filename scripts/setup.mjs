import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const secret = () => randomBytes(32).toString('hex');
const target = path.join(root, '.env');
if (!existsSync(target)) {
  let template = readFileSync(path.join(root, '.env.example'), 'utf8');
  const dbPassword = secret();
  template = template.replaceAll('SUBSTITUA_POR_SEGREDO_HEXADECIMAL', dbPassword)
    .replace('SUBSTITUA_POR_SENHA_COM_12_OU_MAIS_CARACTERES', secret().slice(0, 24))
    .replace('SUBSTITUA_POR_TOKEN_ALEATORIO_DE_64_CARACTERES', secret());
  writeFileSync(target, template, { mode: 0o600 });
  console.log('Criado .env com segredos aleatórios. Consulte USER_EMAIL e USER_PASSWORD para entrar.');
} else console.log('.env existente preservado.');
const firmware = path.join(root, 'produtor/secrets.h');
if (!existsSync(firmware)) {
  process.loadEnvFile(target);
  if (process.env.DEVICE_TOKEN && process.env.DEVICE_ID) {
    let template = readFileSync(path.join(root, 'produtor/secrets.example.h'), 'utf8');
    template = template.replace('COLOQUE_AQUI_O_MESMO_DEVICE_TOKEN_DO_SERVIDOR', process.env.DEVICE_TOKEN)
      .replace('static const char* DEVICE_ID = "esp32-mesa-01";', `static const char* DEVICE_ID = ${JSON.stringify(process.env.DEVICE_ID)};`);
    writeFileSync(firmware, template, { mode: 0o600 });
    console.log('Criado produtor/secrets.h com a credencial do dispositivo. Configure API_BASE_URL antes de simular.');
  }
}
const mobile = path.join(root, 'mobile/.env');
if (!existsSync(mobile)) {
  writeFileSync(mobile, 'EXPO_PUBLIC_API_URL=http://localhost:3000\n', { mode: 0o600 });
  console.log('Criado mobile/.env para simulador iOS. Em celular/Wokwi, configure uma URL HTTPS pública.');
}
