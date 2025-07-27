/* eslint-disable no-param-reassign */

import cssesc from "cssesc";
import moment from "moment";
import RandExp from "randexp";

import DataGenerator from "src/common/data-generator";
import { SanitizeText, DEFAULT_EMAIL_CUSTOM_FIELD } from "src/common/helpers";
import { IFakeFillerOptions, ICustomField, CustomFieldTypes } from "src/types";

type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

class ElementFiller {
  private generator: DataGenerator;
  private options: IFakeFillerOptions;
  private profileIndex: number;

  private previousValue: string;
  private previousPassword: string;
  private previousUsername: string;
  private previousFirstName: string;
  private previousLastName: string;

  private useAI: boolean = true; // Enable AI by default

  constructor(options: IFakeFillerOptions, profileIndex = -1) {
    this.options = options;
    this.profileIndex = profileIndex;
    this.generator = new DataGenerator();

    this.previousValue = "";
    this.previousPassword = "";
    this.previousUsername = "";
    this.previousFirstName = "";
    this.previousLastName = "";
  }

  private fireEvents(element: FillableElement): void {
    ["input", "click", "change", "blur"].forEach((event) => {
      const changeEvent = new Event(event, { bubbles: true, cancelable: true });
      element.dispatchEvent(changeEvent);
    });
  }

  private isAnyMatch(haystack: string, needles: string[]): boolean {
    for (let i = 0, count = needles.length; i < count; i += 1) {
      if (new RegExp(needles[i], "i").test(haystack)) {
        return true;
      }
    }
    return false;
  }

  private isElementVisible(element: FillableElement): boolean {
    if (!element.offsetHeight && !element.offsetWidth) {
      return false;
    }
    if (window.getComputedStyle(element).visibility === "hidden") {
      return false;
    }
    return true;
  }

  private shouldIgnoreElement(element: FillableElement): boolean {
    if (["button", "submit", "reset", "file", "hidden", "image"].indexOf(element.type) > -1) {
      return true;
    }

    // Ignore any invisible elements.
    if (this.options.ignoreHiddenFields && !this.isElementVisible(element)) {
      return true;
    }

    // Ignore any elements that match an item in the the "ignoredFields" array.
    const elementName = this.getElementName(element);
    if (this.isAnyMatch(elementName, this.options.ignoredFields)) {
      return true;
    }

    if (this.options.ignoreFieldsWithContent) {
      // A radio button list will be ignored if it has been selected previously.
      if (element.type === "radio") {
        if (document.querySelectorAll(`input[name="${element.name}"]:checked`).length > 0) {
          return true;
        }
      }

      // All elements excluding radio buttons and check boxes will be ignored if they have a value.
      if (element.type !== "checkbox" && element.type !== "radio") {
        const elementValue = element.value;
        if (elementValue && elementValue.trim().length > 0) {
          return true;
        }
      }
    }

    // If all above checks have failed, we do not need to ignore this element.
    return false;
  }

  private selectRandomRadio(name: string, valuesList: string[] = []): void {
    const list = [];
    const elements = document.getElementsByName(name) as NodeListOf<HTMLInputElement>;

    for (let i = 0; i < elements.length; i += 1) {
      if (elements[i].type === "radio" && (valuesList.length === 0 || valuesList.includes(elements[i].value))) {
        list.push(elements[i]);
      }
    }

    const radioElement = list[Math.floor(Math.random() * list.length)];
    radioElement.checked = true;
    this.fireEvents(radioElement);
  }

  private findCustomFieldFromList(
    fields: ICustomField[],
    elementName: string,
    matchTypes: CustomFieldTypes[] = []
  ): ICustomField | undefined {
    const doMatchType = matchTypes.length > 0;

    for (let i = 0; i < fields.length; i += 1) {
      if (this.isAnyMatch(elementName, fields[i].match)) {
        if (doMatchType) {
          for (let j = 0; j < matchTypes.length; j += 1) {
            if (fields[i].type === matchTypes[j]) {
              return fields[i];
            }
          }
        } else {
          return fields[i];
        }
      }
    }

    return undefined;
  }

  private findCustomField(elementName: string, matchTypes: CustomFieldTypes[] = []): ICustomField | undefined {
    let foundField: ICustomField | undefined;

    // Try finding the custom field from a profile if available.
    if (this.profileIndex > -1) {
      foundField = this.findCustomFieldFromList(
        this.options.profiles[this.profileIndex].fields,
        elementName,
        matchTypes
      );
    }

    // If a custom field could not be found from the profile, try getting one from the default list.
    if (!foundField) {
      foundField = this.findCustomFieldFromList(this.options.fields, elementName, matchTypes);
    }

    return foundField;
  }

  private getElementName(element: FillableElement): string {
    let normalizedName = "";

    if (this.options.fieldMatchSettings.matchName) {
      normalizedName += ` ${SanitizeText(element.name)}`;
    }

    if (this.options.fieldMatchSettings.matchId) {
      normalizedName += ` ${SanitizeText(element.id)}`;
    }

    if (this.options.fieldMatchSettings.matchClass) {
      normalizedName += ` ${SanitizeText(element.className)}`;
    }

    if (this.options.fieldMatchSettings.matchPlaceholder) {
      normalizedName += ` ${SanitizeText(element.getAttribute("placeholder") || "")}`;
    }

    if (this.options.fieldMatchSettings.matchLabel) {
      const normalizedId = cssesc(element.id);
      const labels = document.querySelectorAll(`label[for='${normalizedId}']`);
      for (let i = 0; i < labels.length; i += 1) {
        normalizedName += ` ${SanitizeText(labels[i].innerHTML)}`;
      }
    }

    if (this.options.fieldMatchSettings.matchAriaLabel) {
      normalizedName += ` ${SanitizeText(element.getAttribute("aria-label") || "")}`;
    }

    if (this.options.fieldMatchSettings.matchAriaLabelledBy) {
      const labelIds = (element.getAttribute("aria-labelledby") || "").split(" ");
      for (let i = 0; i < labelIds.length; i += 1) {
        const labelElement = document.getElementById(labelIds[i]);
        if (labelElement) {
          normalizedName += ` ${SanitizeText(labelElement.innerHTML || "")}`;
        }
      }
    }

    return normalizedName;
  }

  private getElementMaxLength(element: HTMLInputElement | HTMLTextAreaElement | undefined): number {
    if (element && element.maxLength && element.maxLength > 0) {
      return element.maxLength;
    }
    return this.options.defaultMaxLength;
  }

  private async generateDummyDataForCustomField(
    customField: ICustomField | undefined,
    element: HTMLInputElement | HTMLTextAreaElement | undefined = undefined
  ): Promise<string> {
    if (this.useAI && customField) {
      try {
        const fieldType = customField.type || element?.type || "text";
        const label = element?.getAttribute("aria-label") || element?.name || "unknown";
        const context = customField.template || "";

        // Use Mistral AI for value generation
        const aiValue = await this.generator.generateAIValue(fieldType, label, context);
        if (aiValue) {
          return aiValue;
        }
      } catch (error) {
        console.error("AI generation failed:", error);
      }
    }

    // Fallback to local generation
    return this.generator.phrase(this.getElementMaxLength(element));
  }

  public async fillInputElement(element: HTMLInputElement): Promise<void> {
    if (this.shouldIgnoreElement(element)) {
      return;
    }

    let fireEvent = true;
    const elementType = element.type ? element.type.toLowerCase() : "";

    switch (elementType) {
      case "checkbox": {
        if (this.isAnyMatch(element.name.toLowerCase(), this.options.agreeTermsFields)) {
          element.checked = true;
        } else {
          element.checked = Math.random() > 0.5;
        }
        break;
      }

      case "date": {
        const dateCustomField = this.findCustomField(this.getElementName(element), ["date"]);

        if (dateCustomField) {
          element.value = this.generateDummyDataForCustomField(dateCustomField, element);
        } else {
          let minDate: Date | undefined;
          let maxDate: Date | undefined;

          if (element.min) {
            if (moment(element.min).isValid()) {
              minDate = moment(element.min).toDate();
            }
          }

          if (element.max) {
            if (moment(element.max).isValid()) {
              maxDate = moment(element.max).toDate();
            }
          }

          element.value = this.generator.date(minDate, maxDate);
        }
        break;
      }

      case "datetime": {
        element.value = `${this.generator.date()}T${this.generator.time()}Z`;
        break;
      }

      case "datetime-local": {
        element.value = `${this.generator.date()}T${this.generator.time()}`;
        break;
      }

      case "time": {
        element.value = this.generator.time();
        break;
      }

      case "month": {
        element.value = `${this.generator.year()}-${this.generator.month()}`;
        break;
      }

      case "week":
        element.value = `${this.generator.year()}-W${this.generator.weekNumber()}`;
        break;

      case "email": {
        if (this.isAnyMatch(element.name.toLowerCase(), this.options.confirmFields)) {
          element.value = this.previousValue;
        } else {
          let emailCustomField = this.findCustomField(this.getElementName(element), ["email"]);
          if (!emailCustomField) {
            emailCustomField = DEFAULT_EMAIL_CUSTOM_FIELD;
          }

          this.previousValue = this.generateDummyDataForCustomField(emailCustomField, element);
          element.value = this.previousValue;
        }
        break;
      }

      case "number":
      case "range": {
        let min = element.min ? parseInt(element.min, 10) : 1;
        let max = element.max ? parseInt(element.max, 10) : 100;

        const numberCustomField = this.findCustomField(this.getElementName(element), ["number"]);

        if (numberCustomField) {
          min = numberCustomField.min || min;
          max = numberCustomField.max || max;

          if (element.min && element.max) {
            min = Number(element.min) > min ? Number(element.min) : min;
            max = Number(element.max) < max ? Number(element.max) : max;
          }
        }

        element.value = String(this.generator.randomNumber(min, max));
        break;
      }

      case "password": {
        if (this.isAnyMatch(element.name.toLowerCase(), this.options.confirmFields)) {
          element.value = this.previousPassword;
        } else {
          if (this.options.passwordSettings.mode === "defined") {
            this.previousPassword = this.options.passwordSettings.password;
          } else {
            this.previousPassword = this.generator.scrambledWord(8, 8).toLowerCase();
            // eslint-disable-next-line no-console
            console.info(this.previousPassword);
          }

          element.value = this.previousPassword;
        }
        break;
      }

      case "radio": {
        if (element.name) {
          const matchingCustomField = this.findCustomField(this.getElementName(element), ["randomized-list"]);
          const valuesList = matchingCustomField?.list ? matchingCustomField?.list : [];
          this.selectRandomRadio(element.name, valuesList);
        }
        fireEvent = false;
        break;
      }

      case "tel": {
        const telephoneCustomField = this.findCustomField(this.getElementName(element), [
          "telephone",
          "regex",
          "randomized-list",
        ]);

        if (telephoneCustomField) {
          element.value = this.generateDummyDataForCustomField(telephoneCustomField, element);
        } else {
          element.value = this.generator.phoneNumber();
        }
        break;
      }

      case "url": {
        element.value = this.generator.website();
        break;
      }

      case "color": {
        element.value = this.generator.color();
        break;
      }

      case "search": {
        element.value = this.generator.words(1);
        break;
      }

      default: {
        if (this.isAnyMatch(element.name.toLowerCase(), this.options.confirmFields)) {
          element.value = this.previousValue;
        } else {
          const customField = this.findCustomField(this.getElementName(element));
          this.previousValue = this.generateDummyDataForCustomField(customField, element);
          element.value = this.previousValue;
        }
        break;
      }
    }

    if (this.options.triggerClickEvents && fireEvent) {
      this.fireEvents(element);
    }
  }

  public fillTextAreaElement(element: HTMLTextAreaElement): void {
    if (this.shouldIgnoreElement(element)) {
      return;
    }

    const matchingCustomField = this.findCustomField(this.getElementName(element), [
      "text",
      "alphanumeric",
      "regex",
      "randomized-list",
    ]);

    element.value = this.generateDummyDataForCustomField(matchingCustomField, element);

    if (this.options.triggerClickEvents) {
      this.fireEvents(element);
    }
  }

  public fillSelectElement(element: HTMLSelectElement): void {
    if (this.shouldIgnoreElement(element)) {
      return;
    }

    if (!element.options || element.options.length < 1) {
      return;
    }

    let valueExists = false;
    let valueSelected = false;
    const matchingCustomField = this.findCustomField(this.getElementName(element));

    // If a custom field exists for this element, we use that to determine the value.
    // However, if the generated value is not present in the options list we will select a random one.
    if (matchingCustomField) {
      const value = this.generateDummyDataForCustomField(matchingCustomField);

      for (let i = 0; i < element.options.length; i += 1) {
        if (element.options[i].value === value) {
          element.options[i].selected = true;
          valueExists = true;
          valueSelected = true;
          break;
        }
      }
    }

    if (!valueExists) {
      const optionsCount = element.options.length;
      const skipFirstOption = !!element.options[0].value === false;

      if (element.multiple) {
        // Unselect any existing options.
        for (let i = 0; i < optionsCount; i += 1) {
          if (!element.options[i].disabled) {
            element.options[i].selected = false;
          }
        }

        // Select a random number of options.
        const numberOfOptionsToSelect = this.generator.randomNumber(1, optionsCount);

        for (let i = 0; i < numberOfOptionsToSelect; i += 1) {
          if (!element.options[i].disabled) {
            element.options[this.generator.randomNumber(1, optionsCount - 1)].selected = true;
            valueSelected = true;
          }
        }
      } else {
        // Select a random option as long as it is not disabled.
        // If it is disabled, continue finding a random option that can be selected.

        let iterations = 0;

        while (iterations < optionsCount) {
          const randomOptionIndex = this.generator.randomNumber(skipFirstOption ? 1 : 0, optionsCount - 1);

          if (!element.options[randomOptionIndex].disabled) {
            element.options[randomOptionIndex].selected = true;
            valueSelected = true;
            break;
          } else {
            iterations += 1;
          }
        }
      }
    }

    if (valueSelected && this.options.triggerClickEvents) {
      this.fireEvents(element);
    }
  }

  public fillContentEditableElement(element: HTMLElement): void {
    if ((element as HTMLElement).isContentEditable) {
      element.textContent = this.generator.paragraph(5, 100, this.options.defaultMaxLength);
    }
  }
}

export default ElementFiller;
