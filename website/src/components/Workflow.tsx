import { useScrollReveal } from "@/hooks/useScrollReveal";

export default function Workflow() {
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
            Mimodex 工作流
          </h2>
          <p className="text-dark-400 text-lg max-w-xl mx-auto">
            从本地项目到代码变更审阅的完整闭环
          </p>
        </div>

        {/* Workflow image */}
        <div
          className={`mb-16 transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div className="rounded-2xl overflow-hidden border border-dark-800 bg-dark-900/30">
            <img
              src="./images/工作流程图.png"
              alt="Mimodex 工作流程"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        </div>


      </div>
    </section>
  );
}
