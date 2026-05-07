import {
  Box,
  BoxProps,
  Divider,
  Group,
  Loader,
  Paper,
  PolymorphicComponentProps,
  Stack,
  Text,
} from "@mantine/core";
import Editor from "@monaco-editor/react";
import { useMemo } from "react";

export type TerminalOutputProps = {
  lines: string[];
  title?: string;
  loading?: boolean;
} & PolymorphicComponentProps<"div", BoxProps>;

export function TerminalOutput({
  lines,
  title,
  loading,
  ...props
}: TerminalOutputProps) {
  const output = useMemo(() => lines.join("\n"), [lines]);

  return (
    <Box {...props}>
      <Paper radius="md" h="100%" withBorder style={{ overflow: "hidden" }}>
        <Stack h="100%" gap={0}>
          {/* Title bar */}
          {title !== undefined && (
            <>
              <Group justify="space-between" p="xs">
                <Text>{title}</Text>
                {loading && <Loader size="xs" />}
              </Group>
              <Divider />
            </>
          )}

          {/* Editor */}
          <Editor
            height="100%"
            defaultLanguage="shell"
            value={output}
            theme="vs-dark"
            options={{
              readOnly: true,
              wordWrap: "on",
              minimap: { enabled: false },
              lineNumbers: "on",
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 10,
              lineNumbersMinChars: 4,
              renderLineHighlight: "none",
              scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
              scrollBeyondLastLine: true,
              automaticLayout: true,
              domReadOnly: true,
            }}
          />
        </Stack>
      </Paper>
    </Box>
  );
}
