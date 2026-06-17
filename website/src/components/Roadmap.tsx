import { useScrollReveal } from "@/hooks/useScrollReveal";

export default function Roadmap() {
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  return (
    <section ref={ref} className="relative py-24 sm:py-32 bg-dark-950">
      <div className="container mx-auto px-4">
        {/* Section header */}
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            模型支持路线图
          </h2>
          <p className="text-dark-400 text-lg max-w-xl mx-auto">
            先兼容 MiMo，后续持续扩展
          </p>
        </div>

        {/* Roadmap image */}
        <div
          className={`mb-16 transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div className="rounded-2xl overflow-hidden border border-dark-800 bg-dark-900/30">
            <img
              src="./images/模型路线图.png"
              alt="Mimodex 模型支持路线图"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        </div>


      </div>
    </section>
  );
}
