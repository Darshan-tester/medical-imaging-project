export function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.38} color="#93A5C4" />
      <pointLight position={[4, 3, 5]} intensity={16} color="#3B82F6" distance={16} decay={2} />
      <pointLight position={[-5, -2, 3]} intensity={6} color="#22D3EE" distance={16} decay={2} />
      <pointLight position={[0, -4, -3]} intensity={6} color="#15213A" distance={14} decay={2} />
    </>
  );
}
