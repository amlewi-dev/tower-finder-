import { ScrollView } from "react-native";
import { AGES, OP_COLOR, OPERATORS } from "./config";
import { useApp } from "./state";
import { Chip } from "./ui";

export function Filters() {
  const { operator, setOperator, age, setAge } = useApp();
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        <Chip label="All operators" active={operator === null} onPress={() => setOperator(null)} />
        {OPERATORS.map((o) => (
          <Chip key={o} label={o} color={OP_COLOR[o]} active={operator === o} onPress={() => setOperator(o)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        {AGES.map((a) => (
          <Chip key={a.key} label={a.label} active={age === a.key} onPress={() => setAge(a.key)} />
        ))}
      </ScrollView>
    </>
  );
}
