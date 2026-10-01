"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registrarDialogoConsentimiento } from "@/lib/ia-cliente";

/**
 * Autorización para enviar datos de salud a la IA (Ley 1581 de 2012). Lo abre
 * `fetchIA` la primera vez que una función los necesita. Si cambia este
 * texto, hay que subir VERSION_CONSENTIMIENTO_IA en lib/seguridad/consentimiento.ts.
 */
export function DialogoConsentimiento() {
  const [responder, setResponder] = useState<((acepta: boolean) => void) | null>(null);

  useEffect(
    () => registrarDialogoConsentimiento((r) => setResponder(() => r)),
    []
  );

  function cerrar(acepta: boolean) {
    responder?.(acepta);
    setResponder(null);
  }

  return (
    <Dialog.Root open={responder !== null} onOpenChange={(abierto) => !abierto && cerrar(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-xl focus:outline-none">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-teal" />
            <Dialog.Title className="text-base font-bold text-foreground">
              ¿Autorizás el uso de tus datos de salud?
            </Dialog.Title>
          </div>

          <Dialog.Description className="mb-3 text-sm text-muted-foreground leading-relaxed">
            Para generar este análisis, Pulso envía tus datos de salud a{" "}
            <strong className="text-foreground">Anthropic (Claude)</strong>, un servicio de IA con
            servidores fuera de Colombia.
          </Dialog.Description>

          <ul className="mb-4 space-y-1.5 text-xs text-muted-foreground">
            <li>
              <strong className="text-foreground">Qué se envía:</strong> tus métricas (presión, frecuencia,
              peso, sueño, estrés), tu perfil (edad, sexo, altura, tabaquismo) y el informe que calcula la app.
            </li>
            <li>
              <strong className="text-foreground">Qué no:</strong> ningún identificador tuyo. Tus datos en
              Pulso son anónimos.
            </li>
            <li>
              <strong className="text-foreground">Para qué:</strong> solo para redactar tus análisis, tips y
              rutinas. Es orientación educativa, no un diagnóstico.
            </li>
            <li>
              <strong className="text-foreground">Tus derechos:</strong> podés revocar esta autorización o
              borrar todos tus datos cuando quieras, desde Privacidad.
            </li>
          </ul>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => cerrar(false)}>
              No, gracias
            </Button>
            <Button onClick={() => cerrar(true)}>Autorizo</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
